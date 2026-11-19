using System.Net.NetworkInformation;
using System.Net.Sockets;
using Server.Relay;

const int DefaultPort = 5279;

var builder = WebApplication.CreateBuilder(args);

// All interfaces, so a second machine on the LAN can connect
if (string.IsNullOrEmpty(builder.Configuration["urls"]))
    builder.WebHost.UseUrls($"http://0.0.0.0:{DefaultPort}");

builder.Services.AddSingleton<RelayHub>();

var app = builder.Build();

app.UseWebSockets(new WebSocketOptions
{
    // Detects a peer that vanished without closing (cable pulled, machine asleep)
    KeepAliveInterval = TimeSpan.FromSeconds(5),
    KeepAliveTimeout = TimeSpan.FromSeconds(15)
});

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context => context.Context.Response.Headers.CacheControl = "no-store"
});

app.Map("/ws", WebSocketRelay.HandleAsync);

app.Lifetime.ApplicationStarted.Register(() =>
{
    var port = app.Urls.Select(url => new Uri(url.Replace("0.0.0.0", "localhost").Replace("[::]", "localhost")).Port)
        .DefaultIfEmpty(DefaultPort).First();
    var lanAddresses = NetworkInterface.GetAllNetworkInterfaces()
        .Where(nic => nic.OperationalStatus == OperationalStatus.Up && nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
        .SelectMany(nic => nic.GetIPProperties().UnicastAddresses)
        .Where(address => address.Address.AddressFamily == AddressFamily.InterNetwork)
        .Select(address => address.Address.ToString());

    Console.WriteLine();
    Console.WriteLine($"  This PC:        http://localhost:{port}");
    foreach (var address in lanAddresses)
        Console.WriteLine($"  Other machines: http://{address}:{port}");
    Console.WriteLine($"  Internet:       cloudflared tunnel --url http://localhost:{port}");
    Console.WriteLine();
});

app.Run();

public partial class Program;
