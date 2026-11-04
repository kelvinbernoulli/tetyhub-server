import hashlib
import subprocess

commits = ["c302c7f", "4c6cd37", "3ffb130"]

migrations = [
    "prisma/migrations/20260924150000_notification_indexes/migration.sql",
    "prisma/migrations/20260925120000_vendor_shipment_tracking/migration.sql",
    "prisma/migrations/20260925140000_restore_booking_payment_history/migration.sql",
]

expected = {
    "20260924150000_notification_indexes": "1c0396dffb3dd97f71537540f0ab8aa93a8f9e6ef7d1b0dfe2c09ccb36b64829",
    "20260925120000_vendor_shipment_tracking": "df8a1b674a464089e43171a11b26d6eb9e1832c8e8e8274b3476b02008e9185b",
    "20260925140000_restore_booking_payment_history": "92781a5b820df2311ea69c4c87c6e903a475e822da9109e76974252d9aaf90aa",
}

for path in migrations:
    name = path.split("/")[-2]
    print(f"\n{name}")
    print(f"Database: {expected[name]}")

    for commit in commits:
        result = subprocess.run(
            ["git", "show", f"{commit}:{path}"],
            capture_output=True,
            check=False,
        )

        if result.returncode != 0:
            print(f"{commit}: file unavailable")
            continue

        digest = hashlib.sha256(result.stdout).hexdigest()
        match = digest == expected[name]
        print(f"{commit}: {digest} {'MATCH' if match else ''}")
