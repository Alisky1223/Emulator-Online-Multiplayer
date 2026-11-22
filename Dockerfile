FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Server/Server/Server.csproj src/Server/Server/
RUN dotnet restore src/Server/Server/Server.csproj
COPY src/Server/Server/ src/Server/Server/
RUN dotnet publish src/Server/Server/Server.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# Render routes to $PORT, which defaults to 10000
ENV ASPNETCORE_URLS=http://0.0.0.0:10000
EXPOSE 10000
ENTRYPOINT ["dotnet", "Server.dll"]
