using System.Net.NetworkInformation;
using System.Net.Sockets;
using Microsoft.AspNetCore.StaticFiles;
using Server.Relay;

const int DefaultPort = 5279;
const int PlayerPort = 5280;

var builder = WebApplication.CreateBuilder(args);
var mode = builder.Configuration["RunMode"];
var playerOnly = string.Equals(mode, "Player", StringComparison.OrdinalIgnoreCase);
var relayOnly = string.Equals(mode, "Relay", StringComparison.OrdinalIgnoreCase);
var mobileHost = string.Equals(mode, "Mobile", StringComparison.OrdinalIgnoreCase);

if (string.IsNullOrEmpty(builder.Configuration["urls"]))
    builder.WebHost.UseUrls(playerOnly ? $"http://localhost:{PlayerPort}" : $"http://0.0.0.0:{DefaultPort}");

if (!playerOnly)
    builder.Services.AddSingleton<RelayHub>();

var app = builder.Build();

if (mobileHost && !Directory.Exists(Path.Combine(app.Environment.WebRootPath, "vendor", "emulatorjs")))
    throw new InvalidOperationException("Mobile hosting requires the bundled emulator files in the portable ZIP.");

if (!playerOnly)
{
    app.UseWebSockets(new WebSocketOptions
    {
        // Detects a peer that vanished without closing (cable pulled, machine asleep)
        KeepAliveInterval = TimeSpan.FromSeconds(5),
        KeepAliveTimeout = TimeSpan.FromSeconds(15)
    });
    app.Map("/ws", WebSocketRelay.HandleAsync);
}

if (!relayOnly)
{
    app.UseDefaultFiles();
    var contentTypes = new FileExtensionContentTypeProvider();
    contentTypes.Mappings[".data"] = "application/octet-stream";
    app.UseStaticFiles(new StaticFileOptions
    {
        ContentTypeProvider = contentTypes,
        OnPrepareResponse = context => context.Context.Response.Headers.CacheControl =
            context.Context.Request.Path.StartsWithSegments("/vendor")
                ? "public, max-age=604800"
                : "no-store"
    });
}

app.MapGet("/health", () => Results.Ok());

app.Lifetime.ApplicationStarted.Register(() =>
{
    var port = app.Urls.Select(url => new Uri(url.Replace("0.0.0.0", "localhost").Replace("[::]", "localhost")).Port)
        .DefaultIfEmpty(playerOnly ? PlayerPort : DefaultPort).First();
    if (playerOnly)
    {
        Console.WriteLine($"  Open the player: http://localhost:{port}");
        return;
    }

    var lanAddresses = NetworkInterface.GetAllNetworkInterfaces()
        .Where(nic => nic.OperationalStatus == OperationalStatus.Up && nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
        .SelectMany(nic => nic.GetIPProperties().UnicastAddresses)
        .Where(address => address.Address.AddressFamily == AddressFamily.InterNetwork)
        .Select(address => address.Address.ToString());

    Console.WriteLine();
    Console.WriteLine($"  {(relayOnly ? "Local relay:" : "This PC:")} http://localhost:{port}");
    foreach (var address in lanAddresses)
        Console.WriteLine($"  {(mobileHost ? "Open on phone:" : "Other machines:")} http://{address}:{port}");
    Console.WriteLine($"  Internet:       cloudflared tunnel --url http://localhost:{port}");
    Console.WriteLine();
});

app.Run();

public partial class Program;
