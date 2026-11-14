using Server.Relay;

namespace Unit.Tests;

public class RelayHubTests
{
    private sealed class FakePeer : IPeer
    {
        public List<string> Received { get; } = [];

        public Task SendAsync(string message, CancellationToken cancellationToken = default)
        {
            Received.Add(message);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task First_joiner_is_player_1_second_is_player_2()
    {
        var hub = new RelayHub();
        var a = new FakePeer();
        var b = new FakePeer();

        var seatA = await hub.JoinAsync("room", a);
        var seatB = await hub.JoinAsync("room", b);

        Assert.Equal(1, seatA!.Player);
        Assert.Equal(2, seatB!.Player);
        Assert.Equal([ServerMessages.Joined(1, false), ServerMessages.PeerJoined], a.Received);
        Assert.Equal([ServerMessages.Joined(2, true)], b.Received);
    }

    [Fact]
    public async Task Third_joiner_is_rejected_and_the_others_are_not_disturbed()
    {
        var hub = new RelayHub();
        var a = new FakePeer();
        var b = new FakePeer();
        var c = new FakePeer();
        await hub.JoinAsync("room", a);
        await hub.JoinAsync("room", b);
        a.Received.Clear();
        b.Received.Clear();

        var seatC = await hub.JoinAsync("room", c);

        Assert.Null(seatC);
        Assert.Contains("\"type\":\"rejected\"", Assert.Single(c.Received));
        Assert.Contains("\"reason\":\"room-full\"", c.Received[0]);
        Assert.Empty(a.Received);
        Assert.Empty(b.Received);
    }

    [Fact]
    public async Task Messages_go_to_the_other_peer_of_the_same_room_only()
    {
        var hub = new RelayHub();
        var a = new FakePeer();
        var b = new FakePeer();
        var elsewhere = new FakePeer();
        var seatA = await hub.JoinAsync("room", a);
        var seatB = await hub.JoinAsync("room", b);
        await hub.JoinAsync("other-room", elsewhere);
        a.Received.Clear();
        b.Received.Clear();
        elsewhere.Received.Clear();

        await seatA!.RelayAsync("from-a");
        await seatB!.RelayAsync("from-b");

        Assert.Equal(["from-b"], a.Received);
        Assert.Equal(["from-a"], b.Received);
        Assert.Empty(elsewhere.Received);
    }

    [Fact]
    public async Task Message_without_a_peer_is_dropped()
    {
        var hub = new RelayHub();
        var a = new FakePeer();
        var seatA = await hub.JoinAsync("room", a);

        await seatA!.RelayAsync("nobody-there");

        Assert.Equal([ServerMessages.Joined(1, false)], a.Received);
    }

    [Fact]
    public async Task Leaving_notifies_the_other_peer_and_frees_the_seat()
    {
        var hub = new RelayHub();
        var a = new FakePeer();
        var b = new FakePeer();
        var c = new FakePeer();
        var seatA = await hub.JoinAsync("room", a);
        await hub.JoinAsync("room", b);
        b.Received.Clear();

        await seatA!.LeaveAsync();
        await seatA.LeaveAsync();
        await seatA.RelayAsync("after-leaving");

        Assert.Equal([ServerMessages.PeerLeft], b.Received);

        var seatC = await hub.JoinAsync("room", c);
        Assert.Equal(1, seatC!.Player);
        Assert.Equal([ServerMessages.Joined(1, true)], c.Received);
    }

    [Fact]
    public async Task Room_is_removed_when_the_last_peer_leaves()
    {
        var hub = new RelayHub();
        var seatA = await hub.JoinAsync("room", new FakePeer());
        var seatB = await hub.JoinAsync("room", new FakePeer());
        Assert.Equal(1, hub.RoomCount);

        await seatA!.LeaveAsync();
        await seatB!.LeaveAsync();

        Assert.Equal(0, hub.RoomCount);
    }

    [Fact]
    public async Task Room_codes_ignore_case_and_surrounding_spaces()
    {
        var hub = new RelayHub();
        await hub.JoinAsync("Abc", new FakePeer());

        var seat = await hub.JoinAsync(" aBC ", new FakePeer());

        Assert.Equal(2, seat!.Player);
        Assert.Equal("ABC", seat.Room);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("has space")]
    [InlineData("quote\"")]
    [InlineData("0123456789012345678901234567890123")]
    public async Task Invalid_room_code_is_rejected(string? code)
    {
        var hub = new RelayHub();
        var peer = new FakePeer();

        var seat = await hub.JoinAsync(code, peer);

        Assert.Null(seat);
        Assert.Contains("\"reason\":\"bad-room\"", Assert.Single(peer.Received));
        Assert.Equal(0, hub.RoomCount);
    }
}
