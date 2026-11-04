import hashlib
import subprocess

migrations = {
    "20260924150000_notification_indexes": "1c0396dffb3dd97f71537540f0ab8aa93a8f9e6ef7d1b0dfe2c09ccb36b64829",
    "20260925120000_vendor_shipment_tracking": "df8a1b674a464089e43171a11b26d6eb9e1832c8e8e8274b3476b02008e9185b",
    "20260925140000_restore_booking_payment_history": "92781a5b820df2311ea69c4c87c6e903a475e822da9109e76974252d9aaf90aa",
}

commits = subprocess.check_output(
    ["git", "rev-list", "--all"],
    text=True
).splitlines()

for folder, expected in migrations.items():
    path = f"prisma/migrations/{folder}/migration.sql"
    matches = []
    seen = set()

    print(f"\nSearching: {folder}")

    for commit in commits:
        result = subprocess.run(
            ["git", "show", f"{commit}:{path}"],
            capture_output=True
        )

        if result.returncode != 0:
            continue

        content = result.stdout
        digest = hashlib.sha256(content).hexdigest()

        if digest == expected:
            matches.append((commit, "exact"))

        # Also test common line-ending variations.
        normalized = content.replace(b"\r\n", b"\n")
        if hashlib.sha256(normalized).hexdigest() == expected:
            matches.append((commit, "LF"))

        crlf = normalized.replace(b"\n", b"\r\n")
        if hashlib.sha256(crlf).hexdigest() == expected:
            matches.append((commit, "CRLF"))

    if matches:
        for commit, variant in matches:
            print(f"MATCH: {commit} ({variant})")
    else:
        print("No matching version found in available Git history.")
