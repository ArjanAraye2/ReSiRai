FROM mcr.microsoft.com/dotnet/aspnet:10.0

# rsync: mirror تصاویر; postgresql-client: pg_dump/pg_restore برای پشتیبان
RUN apt-get update \
    && apt-get install -y --no-install-recommends rsync postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY publish/ .

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "ReSiRai.Api.dll"]
