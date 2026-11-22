using System.Net.WebSockets;
using System.Text;

namespace Server.Relay;

public sealed class WebSocketPeer(WebSocket socket) : IPeer
{
    // WebSocket allows one send at a time; relayed messages and room notices can overlap
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    public async Task SendAsync(string message, CancellationToken cancellationToken = default)
    {
        var bytes = Encoding.UTF8.GetBytes(message);
        try
        {
            await _sendLock.WaitAsync(cancellationToken);
            try
            {
                if (socket.State == WebSocketState.Open)
                    await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
            }
            finally
            {
                _sendLock.Release();
            }
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // A peer that is going away is reported through its own receive loop
        }
    }
}

public static class WebSocketRelay
{
    public const int MaxMessageBytes = 16 * 1024;

    public static async Task HandleAsync(HttpContext context, RelayHub hub, IHostApplicationLifetime lifetime, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Relay");
        var remote = context.Connection.RemoteIpAddress;
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("WebSocket endpoint: connect with ws://host/ws?room=CODE");
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, lifetime.ApplicationStopping);
        var peer = new WebSocketPeer(socket);

        // Rejections are sent as a message: browsers cannot read a failed handshake's status
        var seat = await hub.JoinAsync(context.Request.Query["room"], peer, stop.Token);
        if (seat is null)
        {
            log.LogInformation("Rejected {Remote}, room {Room}", remote, context.Request.Query["room"].ToString());
            await CloseAsync(socket, WebSocketCloseStatus.PolicyViolation, "rejected");
            return;
        }

        log.LogInformation("Room {Room}: player {Player} joined from {Remote}", seat.Room, seat.Player, remote);
        var closeStatus = WebSocketCloseStatus.NormalClosure;
        var started = DateTime.UtcNow;
        string? error = null;
        try
        {
            closeStatus = await PumpAsync(socket, seat, stop.Token);
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException)
        {
            closeStatus = WebSocketCloseStatus.EndpointUnavailable;
            error = e.Message;
        }
        finally
        {
            // Why a peer left is the first thing to know when a remote game drops
            log.LogInformation("Room {Room}: player {Player} left after {Seconds:F0} s, {Status} {Error}",
                seat.Room, seat.Player, (DateTime.UtcNow - started).TotalSeconds, closeStatus, error);
            await seat.LeaveAsync();
            await CloseAsync(socket, closeStatus, "");
        }
    }

    private static async Task<WebSocketCloseStatus> PumpAsync(WebSocket socket, RelayHub.Seat seat, CancellationToken cancellationToken)
    {
        var buffer = new byte[MaxMessageBytes];
        while (true)
        {
            var length = 0;
            ValueWebSocketReceiveResult result;
            do
            {
                if (length == buffer.Length) return WebSocketCloseStatus.MessageTooBig;
                result = await socket.ReceiveAsync(buffer.AsMemory(length), cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) return WebSocketCloseStatus.NormalClosure;
                length += result.Count;
            } while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text) return WebSocketCloseStatus.InvalidMessageType;
            await seat.RelayAsync(Encoding.UTF8.GetString(buffer, 0, length), cancellationToken);
        }
    }

    private static async Task CloseAsync(WebSocket socket, WebSocketCloseStatus status, string description)
    {
        if (socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived)) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await socket.CloseAsync(status, description, timeout.Token);
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException)
        {
        }
    }
}
