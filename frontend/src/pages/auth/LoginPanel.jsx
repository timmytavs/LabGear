import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

export default function LoginPanel({ onForgotPassword, onPreviewLoginOtp }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="lg-auth-panel">
      <div className="lg-auth-heading">
        <h2 id="landing-modal-title">Welcome back</h2>
        <p>Sign in to your LabGear account.</p>
      </div>

      <form onSubmit={(event) => event.preventDefault()}>
        <div className="lg-form-group">
          <label className="lg-label" htmlFor="login-username">
            Username <span className="lg-required">*</span>
          </label>

          <div className="lg-auth-input-wrap">
            <UserRound size={19} />
            <input
              id="login-username"
              className="lg-input"
              type="text"
              placeholder="Enter your username"
              autoComplete="username"
              minLength={6}
              maxLength={17}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
        </div>

        <div className="lg-form-group">
          <label className="lg-label" htmlFor="login-password">
            Password <span className="lg-required">*</span>
          </label>

          <div className="lg-auth-input-wrap">
            <LockKeyhole size={19} />
            <input
              id="login-password"
              className="lg-input"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="lg-auth-eye"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </div>

        <div className="lg-auth-forgot">
          <button
            type="button"
            className="lg-auth-forgot-action"
            onClick={onForgotPassword}
          >
            Forgot Password? Reset Here
          </button>
        </div>

        <div className="lg-auth-captcha">
          <ShieldCheck size={22} />
          <div>
            <strong>CAPTCHA Verification</strong>
            <p>
              Server-verified CAPTCHA will be enabled during backend
              integration.
            </p>
          </div>
        </div>

        <button
          type="submit"
          className="lg-button lg-button-primary lg-auth-submit"
          disabled
        >
          Log-in
        </button>

        <p className="lg-auth-dev-note">
          Authentication is not connected yet. Do not enter real account
          credentials during UI testing.
        </p>

        {onPreviewLoginOtp && (
          <button
            type="button"
            className="lg-auth-preview-link"
            onClick={onPreviewLoginOtp}
          >
            Preview Login Email OTP Screen
          </button>
        )}
      </form>
    </div>
  );
}
