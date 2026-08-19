"""CLI for the global macro data ETL pipeline."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from macro_data_etl.src.orchestration.pipeline import Pipeline

app = typer.Typer(
    name="macro-etl",
    help="Global Macro Data ETL — gold rebuild and DuckDB load operations",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()


def _pipeline() -> Pipeline:
    return Pipeline()


def _manifest_table(run) -> Table:
    table = Table(title=f"Run {run.run_id}", show_lines=False, expand=True)
    table.add_column("Stage", style="cyan")
    table.add_column("Source", style="magenta")
    table.add_column("Status")
    table.add_column("Rows", justify="right")
    table.add_column("Details", overflow="fold")
    for s in run.log:
        status = s["status"]
        color = {"ok": "green", "error": "red", "warning": "yellow"}.get(status, "white")
        table.add_row(
            s["stage"], s["source"], f"[{color}]{status}[/{color}]",
            str(s["rows"]), s["details"] or s["path"],
        )
    return table


@app.command("rebuild-gold")
def rebuild_gold() -> None:
    """Rebuild all gold tables from existing silver."""
    pipe = _pipeline()
    run_obj = pipe.rebuild_gold()
    console.print(_manifest_table(run_obj))


@app.command()
def load(
    target: str = typer.Argument("duckdb", help="duckdb | postgres"),
) -> None:
    """Load gold + silver tables into the database."""
    pipe = _pipeline()
    if target != "duckdb":
        console.print("[yellow]Only duckdb wired in this CLI; use the API for postgres.[/yellow]")
        raise typer.Exit(1)
    run = pipe.rebuild_gold()
    console.print(_manifest_table(run))


@app.command()
def status() -> None:
    """Show pipeline status, table counts, and latest run."""
    pipe = _pipeline()
    from macro_data_etl.src.load.loaders import DuckDBLoader

    manifests = sorted((pipe.data_path / "manifest").glob("run_*.json"))
    console.print(f"[bold]Data path:[/bold] {pipe.data_path}")
    console.print(f"[bold]Manifests:[/bold] {len(manifests)}")
    if manifests:
        console.print(f"[bold]Latest run:[/bold] {manifests[-1].name}")

    if Path(pipe.db_path).exists():
        with DuckDBLoader(pipe.db_path) as db:
            counts = db.table_counts()
        table = Table(title="DuckDB tables")
        table.add_column("Table", style="cyan")
        table.add_column("Rows", justify="right")
        for name, n in sorted(counts.items()):
            table.add_row(name, f"{n:,}")
        console.print(table)
    else:
        console.print("[yellow]No DuckDB database yet — run the pipeline first.[/yellow]")


@app.command()
def query(sql: str = typer.Argument(..., help="SQL to run against the macro DuckDB")) -> None:
    """Run a SQL query against the macro database."""
    pipe = _pipeline()
    from macro_data_etl.src.load.loaders import DuckDBLoader

    if not Path(pipe.db_path).exists():
        console.print("[red]No database yet — run the pipeline first.[/red]")
        raise typer.Exit(1)
    with DuckDBLoader(pipe.db_path) as db:
        df = db.query(sql)
    console.print(df)


@app.command()
def export(
    table: str = typer.Argument("country_macro_latest", help="Gold table to export"),
    out: Path = typer.Option(Path("./data/export"), help="Output directory"),
) -> None:
    """Export a gold table to JSON for the terminal data feed."""
    pipe = _pipeline()
    from macro_data_etl.src.load.loaders import DuckDBLoader

    with DuckDBLoader(pipe.db_path) as db:
        path = db.export_json(table, out / f"{table}.json")
    console.print(f"[green]✓ exported[/green] {path}")


if __name__ == "__main__":
    app()
