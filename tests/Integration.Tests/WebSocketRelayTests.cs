using System.Net.WebSockets;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Integration.Tests;

public class WebSocketRelayTests : IClassFixture<WebApplicationFactory<Program>>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    private readonly WebApplicationFactory<Program> _factory;

    public WebSocketRelayTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private Task<WebSocket> ConnectAsync(string room) =>
        _factory.Server.CreateWebSocketClient().ConnectAsync(new Uri($"ws://localhost/ws?room={room}"), CancellationToken.None);

    private static Task SendAsync(WebSocket socket, string text) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);

    private static async Task<string?> ReceiveAsync(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(Timeout);
        var buffer = new byte[4096];
        var result = await socket.ReceiveAsync(buffer, timeout.Token);
        return result.MessageType == WebSocketMessageType.Close ? null : Encoding.UTF8.GetString(buffer, 0, result.Count);
    }

    [Fact]
    public async Task Two_sockets_get_roles_relay_both_ways_and_see_the_peer_leave()
    {
        using var a = await ConnectAsync("relay");
        Assert.Equal("""{"type":"joined","player":1,"peer":false}""", await ReceiveAsync(a));

        using var b = await ConnectAsync("relay");
        Assert.Equal("""{"type":"joined","player":2,"peer":true}""", await ReceiveAsync(b));
        Assert.Equal("""{"type":"peer-joined"}""", await ReceiveAsync(a));

        await SendAsync(a, """{"type":"input","frame":5,"events":[[0,1]]}""");
        Assert.Equal("""{"type":"input","frame":5,"events":[[0,1]]}""", await ReceiveAsync(b));
        await SendAsync(b, """{"type":"input","frame":5,"events":[]}""");
        Assert.Equal("""{"type":"input","frame":5,"events":[]}""", await ReceiveAsync(a));

        await b.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
        Assert.Equal("""{"type":"peer-left"}""", await ReceiveAsync(a));
    }

    [Fact]
    public async Task Third_socket_is_told_the_room_is_full_and_closed()
    {
        using var a = await ConnectAsync("full");
        await ReceiveAsync(a);
        using var b = await ConnectAsync("full");
        await ReceiveAsync(b);

        using var c = await ConnectAsync("full");

        Assert.Contains("\"reason\":\"room-full\"", await ReceiveAsync(c));
        Assert.Null(await ReceiveAsync(c));
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, c.CloseStatus);
    }

    [Fact]
    public async Task Client_page_is_served_at_the_root()
    {
        var html = await _factory.CreateClient().GetStringAsync("/");

        Assert.Contains("netplay.js", html);
    }
}
