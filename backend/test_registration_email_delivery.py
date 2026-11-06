
"""LabGear Backend Step 50: test real registration OTP email delivery.

Run from the LabGear backend folder:
    python test_registration_email_delivery.py
    python test_registration_email_delivery.py --send

The default is a dry run. --send requires typing SEND interactively and
sends a single test email only to the configured Gmail sender's own inbox.

This script creates no database records and cannot verify or activate any
account. Its OTP is generated only for this email-delivery demonstration.
Never print or log OTP codes, email passwords, or signing keys.
"""

import argparse
from datetime import datetime, timedelta, timezone

from app.core.auth_config import AuthConfigurationError, load_auth_settings
from app.core.auth_security import (
    generate_email_otp,
    hash_email_otp,
    verify_email_otp,
)
from app.services.email_delivery_service import (
    EmailConfigurationError,
    EmailDeliveryError,
    _build_registration_message,
    load_smtp_settings,
    send_registration_otp,
)
from app.services.registration_service import PendingRegistration


TEST_USER_ID = "0000-0000"  # Fictional; never inserted into PostgreSQL.


def run_test(*, send: bool = False) -> int:
    print("LabGear Step 50 - Registration OTP Email Delivery Test")
    print("Mode:", "LIVE SEND" if send else "DRY RUN")

    try:
        auth = load_auth_settings()
        smtp = load_smtp_settings()

        # Restrict this test to a Gmail account emailing itself.
        # No recipient address is accepted from command-line input.
        if smtp.host != "smtp.gmail.com":
            print("FAIL: This test requires Gmail SMTP (smtp.gmail.com).")
            return 1

        same_account = smtp.username.casefold() == smtp.from_email.casefold()
        if not same_account:
            print("FAIL: SMTP username and sender address must match.")
            return 1

        otp_code = generate_email_otp()
        expiry = datetime.now(timezone.utc) + timedelta(
            seconds=auth.otp_expiry_seconds
        )

        delivery = PendingRegistration(
            user_id=TEST_USER_ID,
            email_address=smtp.from_email,
            otp_expires_at=expiry,
            otp_code=otp_code,
        )

        otp_digest = hash_email_otp(
            otp_code,
            TEST_USER_ID,
            "registration",
            auth.otp_hmac_key,
        )

        verified = verify_email_otp(
            otp_code,
            otp_digest,
            TEST_USER_ID,
            "registration",
            auth.otp_hmac_key,
        )

        # Prepare the actual email template without sending it.
        message = _build_registration_message(
            delivery,
            smtp.from_email,
        )

        message_valid = (
            message["To"] == smtp.from_email
            and message["Subject"] == "LabGear - Verify your email address"
            and otp_code in message.get_content()
        )

        print(
            "Six-digit OTP generated:",
            len(otp_code) == 6 and otp_code.isdigit(),
        )
        print("OTP digest verified:", verified)
        print("Email recipient is configured sender:", same_account)
        print("Email template prepared:", message_valid)
        print("OTP expiry (seconds):", auth.otp_expiry_seconds)

        if not (
            verified
            and message_valid
            and auth.otp_expiry_seconds == 180
        ):
            print("FAIL: OTP preparation or expiration policy did not pass.")
            print("Database changes: NONE")
            return 1

        if not send:
            print("Email sent: NO")
            print("Database changes: NONE")
            print("Use --send to test real Gmail delivery.")
            return 0

        print(
            "This sends ONE test OTP to your own configured Gmail inbox."
        )

        answer = input(
            "Type SEND to authorize sending: "
        ).strip()

        if answer != "SEND":
            print("Email sent: NO (cancelled)")
            print("Database changes: NONE")
            return 0

        send_registration_otp(delivery)

        print("Gmail SMTP accepted test email: True")
        print("Database changes: NONE")
        print(
            "Check your Gmail Inbox/Spam for: "
            "LabGear - Verify your email address"
        )
        print(
            "This OTP cannot activate an account; "
            "it was never saved."
        )
        return 0

    except (
        AuthConfigurationError,
        EmailConfigurationError,
        EmailDeliveryError,
    ):
        print("FAIL: Authentication configuration or SMTP delivery failed.")
        print(
            "Check your backend .env and Gmail connection; "
            "do not share secrets."
        )
        print("Database changes: NONE")
        return 1

    except (ValueError, TypeError):
        print("FAIL: Test OTP or message validation failed.")
        print("Database changes: NONE")
        return 1

    except (EOFError, KeyboardInterrupt):
        print("\nTest cancelled before completion.")
        print("Database changes: NONE")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run or send one LabGear test OTP "
            "to your own Gmail inbox."
        )
    )

    parser.add_argument(
        "--send",
        action="store_true",
        help="Request a real SMTP send (requires typing SEND).",
    )

    args = parser.parse_args()
    return run_test(send=args.send)


if __name__ == "__main__":
    raise SystemExit(main())
