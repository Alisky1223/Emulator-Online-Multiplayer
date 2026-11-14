namespace Server.Relay;

public interface IPeer
{
    Task SendAsync(string message, CancellationToken cancellationToken = default);
}

public static class ServerMessages
{
    public const string PeerJoined = """{"type":"peer-joined"}""";
    public const string PeerLeft = """{"type":"peer-left"}""";

    public static string Joined(int player, bool peerPresent) =>
        $$"""{"type":"joined","player":{{player}},"peer":{{(peerPresent ? "true" : "false")}}}""";

    public static string Rejected(string reason, string message) =>
        $$"""{"type":"rejected","reason":"{{reason}}","message":"{{message}}"}""";
}

public static class RoomCode
{
    public const int MaxLength = 32;

    public static bool TryNormalize(string? input, out string code)
    {
        code = (input ?? "").Trim().ToUpperInvariant();
        return code.Length is > 0 and <= MaxLength
            && code.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    }
}

/// <summary>In-memory rooms of at most two peers. Relays opaque messages; knows nothing about the game.</summary>
public sealed class RelayHub
{
    public const int PlayersPerRoom = 2;

    private readonly Lock _gate = new();
    private readonly Dictionary<string, IPeer?[]> _rooms = [];

    public int RoomCount
    {
        get { lock (_gate) return _rooms.Count; }
    }

    /// <summary>Returns the seat, or null when the join was rejected (the peer has been told why).</summary>
    public async Task<Seat?> JoinAsync(string? roomCode, IPeer peer, CancellationToken cancellationToken = default)
    {
        if (!RoomCode.TryNormalize(roomCode, out var code))
        {
            await peer.SendAsync(ServerMessages.Rejected("bad-room",
                $"Room code must be 1-{RoomCode.MaxLength} letters, digits, - or _."), cancellationToken);
            return null;
        }

        int slot;
        IPeer? other;
        lock (_gate)
        {
            if (!_rooms.TryGetValue(code, out var peers))
                _rooms[code] = peers = new IPeer?[PlayersPerRoom];
            slot = Array.IndexOf(peers, null);
            if (slot >= 0) peers[slot] = peer;
            other = slot >= 0 ? peers[1 - slot] : null;
        }

        if (slot < 0)
        {
            await peer.SendAsync(ServerMessages.Rejected("room-full",
                $"Room {code} already has two players."), cancellationToken);
            return null;
        }

        // The joiner learns its role before the other side can start talking to it
        await peer.SendAsync(ServerMessages.Joined(slot + 1, other is not null), cancellationToken);
        if (other is not null) await other.SendAsync(ServerMessages.PeerJoined, cancellationToken);
        return new Seat(this, code, slot);
    }

    private IPeer? Other(string code, int slot)
    {
        lock (_gate) return _rooms.TryGetValue(code, out var peers) ? peers[1 - slot] : null;
    }

    private IPeer? Remove(string code, int slot)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(code, out var peers)) return null;
            peers[slot] = null;
            var other = peers[1 - slot];
            if (other is null) _rooms.Remove(code);
            return other;
        }
    }

    public sealed class Seat
    {
        private readonly RelayHub _hub;
        private readonly int _slot;
        private bool _left;

        internal Seat(RelayHub hub, string room, int slot)
        {
            _hub = hub;
            Room = room;
            _slot = slot;
        }

        public string Room { get; }
        public int Player => _slot + 1;

        public Task RelayAsync(string message, CancellationToken cancellationToken = default)
        {
            var other = _left ? null : _hub.Other(Room, _slot);
            return other is null ? Task.CompletedTask : other.SendAsync(message, cancellationToken);
        }

        public Task LeaveAsync(CancellationToken cancellationToken = default)
        {
            if (_left) return Task.CompletedTask;
            _left = true;
            var other = _hub.Remove(Room, _slot);
            return other is null ? Task.CompletedTask : other.SendAsync(ServerMessages.PeerLeft, cancellationToken);
        }
    }
}
