var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello from ${{ values.name }}!");
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run("http://0.0.0.0:${{ values.port }}");
