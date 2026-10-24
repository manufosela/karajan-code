"""Monthly usage report: aggregates events per customer and writes a CSV."""
import csv
from collections import defaultdict


def monthly_report(events, year, month):
    """Count events per customer for the given month."""
    totals = defaultdict(int)
    for event in events:
        if event["year"] == year and event["month"] == month:
            totals[event["customer_id"]] += 1
    return dict(totals)


class ReportWriter:
    """Writes a report as CSV with a header row."""

    def __init__(self, path):
        self.path = path

    def write(self, totals):
        with open(self.path, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["customer_id", "events"])
            for customer_id, count in sorted(totals.items()):
                writer.writerow([customer_id, count])
