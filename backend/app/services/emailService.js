import nodemailer from "nodemailer";
import logger from "./logger.js";

let cachedTransporter = null;

export function useRealEmailOTP() {
  return (
    process.env.USE_REAL_EMAIL_OTP === "true" ||
    process.env.USE_REAL_EMAIL_OTP === "1"
  );
}

function parseSmtpPort() {
  return parseInt(process.env.SMTP_PORT || "587", 10);
}

function parseSmtpSecure(port) {
  if (process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1") {
    return true;
  }

  if (process.env.SMTP_SECURE === "false" || process.env.SMTP_SECURE === "0") {
    return false;
  }

  return port === 465;
}

function getMailFrom() {
  const fromAddress = String(process.env.MAIL_FROM || "").trim();
  const fromName = String(process.env.MAIL_FROM_NAME || "").trim();

  if (!fromAddress) {
    const error = new Error("MAIL_FROM is required for email OTP delivery");
    error.statusCode = 500;
    throw error;
  }

  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

function getTransportConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = parseSmtpPort();
  const secure = parseSmtpSecure(port);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  if (!host) {
    const error = new Error("SMTP_HOST is required for email OTP delivery");
    error.statusCode = 500;
    throw error;
  }

  if (!Number.isFinite(port) || port <= 0) {
    const error = new Error("SMTP_PORT must be a valid number");
    error.statusCode = 500;
    throw error;
  }

  if ((user && !pass) || (!user && pass)) {
    const error = new Error("SMTP_USER and SMTP_PASS must be provided together");
    error.statusCode = 500;
    throw error;
  }

  return {
    host,
    port,
    secure,
    ...(user && pass
      ? {
          auth: {
            user,
            pass,
          },
        }
      : {}),
  };
}

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(getTransportConfig());
  }

  return cachedTransporter;
}

const DEFAULT_BRAND = {
  appName: "Discount Bazar",
  primaryColor: "#0284c7",
  logoUrl: "",
  supportEmail: "",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function getEmailBranding() {
  try {
    const { default: mongoose } = await import("mongoose");
    // Skip the lookup when the DB isn't connected; mongoose would otherwise buffer the query and hang.
    if (mongoose.connection.readyState !== 1) return DEFAULT_BRAND;
    const { default: Setting } = await import("../models/setting.js");
    const settings = await Setting.findOne({
      $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
    })
      .select("appName primaryColor logoUrl supportEmail")
      .maxTimeMS(3000)
      .lean();
    const color = String(settings?.primaryColor || "").trim();
    return {
      appName: settings?.appName || DEFAULT_BRAND.appName,
      primaryColor: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : DEFAULT_BRAND.primaryColor,
      logoUrl: /^https?:\/\//.test(settings?.logoUrl || "") ? settings.logoUrl : "",
      supportEmail: settings?.supportEmail || "",
    };
  } catch (error) {
    logger.warn("Falling back to default email branding", { error: error.message });
    return DEFAULT_BRAND;
  }
}

// Table-based layout with inline styles so it renders consistently in Gmail/Outlook,
// and a forced light card so dark-mode clients don't wash it out.
function renderOtpEmail({ brand, otp, expiresInMinutes, heading, intro, footnote }) {
  const appName = escapeHtml(brand.appName);
  const color = brand.primaryColor;
  const digits = String(otp)
    .split("")
    .map(
      (d) => `<td style="padding:0 5px;"><div style="width:48px;height:56px;line-height:56px;border:2px solid ${color};border-radius:10px;background:#f8fafc;font-size:28px;font-weight:700;color:#0f172a;text-align:center;font-family:'Courier New',monospace;">${escapeHtml(d)}</div></td>`,
    )
    .join("");
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${appName}" height="40" style="display:block;margin:0 auto 8px;max-height:40px;border:0;">`
    : "";
  const support = brand.supportEmail
    ? `Need help? Contact us at <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${color};text-decoration:none;">${escapeHtml(brand.supportEmail)}</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.08);">
    <tr><td align="center" style="background:${color};padding:28px 24px;">
      ${logo}
      <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">${appName}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">Seller Partner</div>
    </td></tr>
    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;text-align:center;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;text-align:center;">${escapeHtml(intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;"><tr>${digits}</tr></table>
      <p style="margin:0 0 24px;font-size:13px;color:#64748b;text-align:center;">This code expires in <strong style="color:#0f172a;">${escapeHtml(expiresInMinutes)} minutes</strong>.</p>
      <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;color:#9a3412;">
        Never share this code with anyone. ${appName} will never ask for your OTP.
      </div>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;text-align:center;">${escapeHtml(footnote)}</p>
    </td></tr>
    <tr><td style="padding:24px 28px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;line-height:1.6;color:#94a3b8;">
      ${support}${support ? "<br>" : ""}&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * @param {"signup"|"reset"} [purpose] - "reset" sends the forgot-password email.
 */
export async function sendSellerVerificationOtpEmail({
  email,
  otp,
  expiresInMinutes,
  purpose = "signup",
}) {
  if (!useRealEmailOTP()) {
    logger.info("Seller email OTP generated in mock mode", {
      email,
      otp,
      purpose,
      mode: "mock",
    });
    return {
      delivered: false,
      mode: "mock",
    };
  }

  const isReset = purpose === "reset";
  const brand = await getEmailBranding();
  const transporter = getTransporter();
  await transporter.sendMail({
    from: getMailFrom(),
    to: email,
    subject: isReset
      ? `Reset your ${brand.appName} seller password`
      : `Verify your ${brand.appName} seller account`,
    text: isReset
      ? `Your seller account password reset code is ${otp}. This code expires in ${expiresInMinutes} minutes. If you did not request a password reset, you can ignore this email — your password will not change.`
      : `Your seller signup verification code is ${otp}. This code expires in ${expiresInMinutes} minutes.`,
    html: renderOtpEmail({
      brand,
      otp,
      expiresInMinutes,
      heading: isReset ? "Reset your password" : "Verify your email",
      intro: isReset
        ? "We received a request to reset your seller account password. Use the code below to continue."
        : `Welcome to ${brand.appName}! Use the code below to verify your email and finish setting up your seller account.`,
      footnote: isReset
        ? "If you did not request a password reset, you can ignore this email — your password will not change."
        : "If you did not try to sign up as a seller, you can safely ignore this email.",
    }),
  });

  return {
    delivered: true,
    mode: "real",
  };
}

export function __resetEmailTransportForTests() {
  cachedTransporter = null;
}
