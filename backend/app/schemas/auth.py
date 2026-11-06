
"""LabGear Step 39: Pydantic request/response schemas for authentication.

Validation only. These classes do not verify CAPTCHA, authenticate users,
validate OTPs against the database, issue sessions, or send emails.

Requires Pydantic v2 and email-validator. Password policy comes from the
existing Step 36 security helpers, so registration and reset use one policy.
"""

import re
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.core.auth_security import password_errors


UserRole = Literal["student", "instructor", "technician", "admin"]
SelfRegistrationRole = Literal["student", "instructor"]
OTPPurpose = Literal["registration", "login", "recovery"]
ID_PATTERN = r"^[0-9]{4}-[0-9]{4}$"
OTP_PATTERN = r"^[0-9]{6}$"


class StrictRequest(BaseModel):
    """Reject unexpected fields rather than silently discarding them."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class RegistrationRequest(StrictRequest):
    # Identity, age, and address are defined by the IT 107 registration form.
    id_number: str = Field(pattern=ID_PATTERN)
    first_name: str = Field(min_length=1, max_length=26)
    middle_name: str | None = Field(default=None, max_length=26)
    family_name: str = Field(min_length=1, max_length=26)
    name_extension: str | None = Field(default=None, max_length=26)
    extension_type: Literal["", "Jr.", "Sr.", "Other"] | None = None
    birthdate: date

    purok_street: str = Field(min_length=1, max_length=50)
    barangay: str = Field(min_length=1, max_length=50)
    municipality_city: str = Field(min_length=1, max_length=50)
    province: str = Field(min_length=1, max_length=50)
    country: str = Field(min_length=1, max_length=50)
    zip_code: str = Field(pattern=r"^[0-9]{4}$")

    email: EmailStr = Field(max_length=100)
    username: str = Field(min_length=6, max_length=17)
    password: str = Field(repr=False, exclude=True)
    confirm_password: str = Field(repr=False, exclude=True)

    # The public signup form must not create privileged accounts.
    role: SelfRegistrationRole
    department: str = Field(min_length=1, max_length=80)
    contact_number: str = Field(
        min_length=7, max_length=20, repr=False, exclude=True
    )
    class_section_or_unit: str = Field(min_length=1, max_length=100)

    # Fixed security questions Q7, Q2 and Q4; never return answers in JSON.
    security_answer_q7: str = Field(
        min_length=1, max_length=200, repr=False, exclude=True
    )
    security_answer_q2: str = Field(
        min_length=1, max_length=200, repr=False, exclude=True
    )
    security_answer_q4: str = Field(
        min_length=1, max_length=200, repr=False, exclude=True
    )
    privacy_consent: Literal[True]

    # The backend must check this token with the CAPTCHA provider.
    captcha_token: str = Field(
        min_length=1, max_length=4096, repr=False, exclude=True
    )
    website: str = Field(
        default="", max_length=255, repr=False, exclude=True
    )

    @field_validator(
        "first_name", "family_name", "purok_street", "barangay",
        "municipality_city", "province", "country", "username",
        "department", "class_section_or_unit", "security_answer_q7",
        "security_answer_q2", "security_answer_q4", "captcha_token",
    )
    @classmethod
    def reject_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This field cannot be blank.")
        return cleaned

    @field_validator("middle_name", "name_extension")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        if re.fullmatch(r"[A-Za-z0-9_.-]{6,17}", value) is None:
            raise ValueError(
                "Use 6–17 letters, digits, underscores, dots, or hyphens."
            )
        return value

    @field_validator("birthdate")
    @classmethod
    def require_adult(cls, value: date) -> date:
        today = datetime.now(ZoneInfo("Asia/Manila")).date()
        years = today.year - value.year - (
            (today.month, today.day) < (value.month, value.day)
        )
        if years < 18:
            raise ValueError("Registrant must be at least 18 years old.")
        return value

    @field_validator("contact_number")
    @classmethod
    def check_contact(cls, value: str) -> str:
        cleaned = value.strip()
        if not re.fullmatch(r"\+?[0-9 ()-]+", cleaned):
            raise ValueError("Enter a valid contact number.")
        digits = re.sub(r"\D", "", cleaned)
        if not 7 <= len(digits) <= 15:
            raise ValueError("Contact number must have 7–15 digits.")
        return cleaned

    @field_validator("password")
    @classmethod
    def valid_password(cls, value: str) -> str:
        issues = password_errors(value)
        if issues:
            raise ValueError(" ".join(issues))
        return value

    @model_validator(mode="after")
    def validate_registration(self):
        if self.password != self.confirm_password:
            raise ValueError("Password and confirmation must match.")
        if self.extension_type == "Other" and not self.name_extension:
            raise ValueError(
                "Specify the name extension when Other is selected."
            )
        if self.extension_type in ("Jr.", "Sr."):
            if self.name_extension not in (None, self.extension_type):
                raise ValueError(
                    "Name extension does not match its selected type."
                )
            self.name_extension = self.extension_type
        return self


class LoginRequest(StrictRequest):
    username: str = Field(min_length=1, max_length=17)
    password: str = Field(min_length=1, repr=False, exclude=True)
    captcha_token: str = Field(
        min_length=1, max_length=4096, repr=False, exclude=True
    )


class OTPVerifyRequest(StrictRequest):
    user_id: str = Field(pattern=ID_PATTERN)
    purpose: OTPPurpose
    otp: str = Field(pattern=OTP_PATTERN, repr=False, exclude=True)


class OTPResendRequest(StrictRequest):
    user_id: str = Field(pattern=ID_PATTERN)
    purpose: OTPPurpose


class RecoveryStartRequest(StrictRequest):
    identifier: str = Field(min_length=1, max_length=100)
    captcha_token: str = Field(
        min_length=1, max_length=4096, repr=False, exclude=True
    )


class RecoveryAnswerRequest(StrictRequest):
    user_id: str = Field(pattern=ID_PATTERN)
    question_code: Literal["Q7", "Q2", "Q4"]
    answer: str = Field(
        min_length=1, max_length=200, repr=False, exclude=True
    )


class ResetPasswordRequest(StrictRequest):
    # Only a validated, single-use server-issued reset token grants reset access.
    reset_token: str = Field(
        min_length=32, max_length=4096, repr=False, exclude=True
    )
    new_password: str = Field(repr=False, exclude=True)
    confirm_new_password: str = Field(repr=False, exclude=True)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        issues = password_errors(value)
        if issues:
            raise ValueError(" ".join(issues))
        return value

    @model_validator(mode="after")
    def passwords_match(self):
        if self.new_password != self.confirm_new_password:
            raise ValueError("New passwords do not match.")
        return self


class MessageResponse(BaseModel):
    message: str


class RegistrationPendingResponse(MessageResponse):
    user_id: str
    verification_required: Literal[True] = True


class LoginOTPRequiredResponse(MessageResponse):
    user_id: str
    otp_required: Literal[True] = True
    # No session token is returned before successful login OTP verification.


class PublicAccountResponse(BaseModel):
    id_number: str
    username: str
    email: EmailStr
    role: UserRole
    department: str
    is_email_verified: bool
    account_status: str
