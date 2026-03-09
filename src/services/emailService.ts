import nodemailer from 'nodemailer'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

interface EmailConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
}

interface ManagerCredentials {
  managerName: string
  managerEmail: string
  managerMobile: string
  regionName: string
  loginUrl: string
}

interface ManagerPasswordReset {
  managerName: string
  managerEmail: string
  regionName: string
  newPassword: string
  loginUrl: string
}

interface TeleshopManagerCredentials {
  managerName: string
  managerEmail: string
  managerMobile: string
  regionName: string
  loginUrl: string
}

interface StaffWelcomeCredentials {
  name: string
  email: string
  mobileNumber: string
  role: string
  loginUrl: string
  regionName?: string
  outletName?: string
}

class EmailService {
  private transporter: nodemailer.Transporter

  constructor() {
    this.transporter = this.createTransporter()
  }

  private createTransporter(): nodemailer.Transporter {
    const config: EmailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    }

    return nodemailer.createTransport(config)
  }

  async sendManagerWelcomeEmail(credentials: ManagerCredentials): Promise<boolean> {
    try {
      const emailHTML = this.createManagerWelcomeTemplate(credentials)
      const emailText = this.createManagerWelcomeText(credentials)

      const mailOptions = {
        from: {
          name: 'Digital Queue Management System',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@dqms.com'
        },
        to: credentials.managerEmail,
        subject: `Welcome to DQMS - Your RTOM Account for ${credentials.regionName}`,
        text: emailText,
        html: emailHTML
      }

      const result = await this.transporter.sendMail(mailOptions)
      console.log('Email sent successfully:', result.messageId)
      return true
    } catch (error) {
      console.error('Failed to send email:', error)
      return false
    }
  }

  async sendManagerPasswordResetEmail(resetData: ManagerPasswordReset): Promise<boolean> {
    try {
      const emailHTML = this.createManagerPasswordResetTemplate(resetData)
      const emailText = this.createManagerPasswordResetText(resetData)

      const mailOptions = {
        from: {
          name: 'Digital Queue Management System',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@dqms.com'
        },
        to: resetData.managerEmail,
        subject: `DQMS Password Reset - Your New Login Credentials`,
        text: emailText,
        html: emailHTML
      }

      const result = await this.transporter.sendMail(mailOptions)
      console.log('Password reset email sent successfully:', result.messageId)
      return true
    } catch (error) {
      console.error('Failed to send password reset email:', error)
      return false
    }
  }

  async sendTeleshopManagerWelcomeEmail(credentials: TeleshopManagerCredentials): Promise<boolean> {
    try {
      const emailHTML = this.createTeleshopManagerWelcomeTemplate(credentials)
      const emailText = this.createTeleshopManagerWelcomeText(credentials)

      const mailOptions = {
        from: {
          name: 'Digital Queue Management System',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@dqms.com'
        },
        to: credentials.managerEmail,
        subject: `Welcome to DQMS - Your Teleshop Manager Account for ${credentials.regionName}`,
        text: emailText,
        html: emailHTML
      }

      const result = await this.transporter.sendMail(mailOptions)
      console.log('Teleshop manager welcome email sent successfully:', result.messageId)
      return true
    } catch (error) {
      console.error('Failed to send teleshop manager welcome email:', error)
      return false
    }
  }

  async sendStaffWelcomeEmail(credentials: StaffWelcomeCredentials): Promise<boolean> {
    try {
      const emailHTML = this.createStaffWelcomeTemplate(credentials)
      const emailText = this.createStaffWelcomeText(credentials)

      const mailOptions = {
        from: {
          name: 'Digital Queue Management System',
          address: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@dqms.com'
        },
        to: credentials.email,
        subject: `Welcome to DQMS - Your ${credentials.role} Account is Ready`,
        text: emailText,
        html: emailHTML
      }

      const result = await this.transporter.sendMail(mailOptions)
      console.log(`${credentials.role} welcome email sent successfully:`, result.messageId)
      return true
    } catch (error) {
      console.error(`Failed to send ${credentials.role} welcome email:`, error)
      return false
    }
  }

  private createManagerWelcomeTemplate(credentials: ManagerCredentials): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
            .credentials-box { background: white; border: 2px solid #e9ecef; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .credential-item { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
            .password { font-family: monospace; font-size: 18px; font-weight: bold; color: #dc3545; }
            .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Welcome to DQMS!</h1>
                <p>Your RTOM Account is Ready</p>
            </div>
            
            <div class="content">
                <h2>Hello ${credentials.managerName},</h2>
                
                <p>Congratulations! Your RTOM (Regional Telecommunication Office Manager) account has been successfully created for the <strong>${credentials.regionName}</strong> region in our Digital Queue Management System.</p>
                
                <div class="credentials-box">
                    <h3>Your Login Credentials</h3>
                    <div class="credential-item">
                        <strong>Mobile Number:</strong> ${credentials.managerMobile}
                    </div>
                    <div class="credential-item">
                        <strong>Note:</strong> Simply use your mobile number to log in - no password required
                    </div>
                </div>
                
                <a href="https://digital-queue-management-platform.vercel.app/manager/login" class="button">Login to Your Account</a>
                
                <h3>Next Steps:</h3>
                <ol>
                    <li>Click the login button above or visit the RTOM portal</li>
                    <li>Log in using your mobile number</li>
                    <li>Start managing your regional operations</li>
                </ol>
                
                <h3>Your Responsibilities:</h3>
                <ul>
                    <li>Manage outlets in the ${credentials.regionName} region</li>
                    <li>Oversee officer registrations and assignments</li>
                    <li>Monitor queue performance and analytics</li>
                    <li>Ensure smooth operations across your region</li>
                </ul>
                
                <p>If you have any questions or need assistance, please contact your system administrator.</p>
                
                <p>Welcome aboard!<br>
                <strong>DQMS Administration Team</strong></p>
            </div>
            
            <div class="footer">
                <p>This is an automated message from the Digital Queue Management System.<br>
                Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    `
  }

  private createManagerWelcomeText(credentials: ManagerCredentials): string {
    return `
Welcome to DQMS - Digital Queue Management System

Hello ${credentials.managerName},

Congratulations! Your RTOM (Regional Telecommunication Office Manager) account has been successfully created for the ${credentials.regionName} region.

LOGIN CREDENTIALS:
==================
Mobile Number: ${credentials.managerMobile}
Note: Simply use your mobile number to log in - no password required

Login URL: https://digital-queue-management-platform.vercel.app/manager/login

NEXT STEPS:
1. Visit the RTOM portal
2. Log in using your mobile number
3. Start managing your regional operations

YOUR RESPONSIBILITIES:
- Manage outlets in the ${credentials.regionName} region
- Oversee officer registrations and assignments
- Monitor queue performance and analytics
- Ensure smooth operations across your region

If you have any questions or need assistance, please contact your system administrator.

Welcome aboard!
DQMS Administration Team

---
This is an automated message from the Digital Queue Management System.
Please do not reply to this email.
    `
  }

  private createManagerPasswordResetTemplate(resetData: ManagerPasswordReset): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
            .credentials-box { background: white; border: 2px solid #e9ecef; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .credential-item { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
            .password { font-family: monospace; font-size: 18px; font-weight: bold; color: #dc3545; }
            .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Password Reset Successful</h1>
                <p>Your DQMS Account Password Has Been Reset</p>
            </div>
            
            <div class="content">
                <h2>Hello ${resetData.managerName},</h2>
                
                <p>Your RTOM account password for the <strong>${resetData.regionName}</strong> region has been reset by the system administrator.</p>
                
                <div class="credentials-box">
                    <h3>Your New Login Credentials</h3>
                    <div class="credential-item">
                        <strong>Email:</strong> ${resetData.managerEmail}
                    </div>
                    <div class="credential-item">
                        <strong>New Password:</strong> 
                        <span class="password">${resetData.newPassword}</span>
                    </div>
                </div>
                
                <a href="${resetData.loginUrl}" class="button">Login to Your Account</a>
                
                <h3>Next Steps:</h3>
                <ol>
                    <li>Click the login button above or visit the manager portal</li>
                    <li>Log in using your email and new password</li>
                    <li>Continue managing your regional operations</li>
                </ol>
                
                <p><strong>Note:</strong> If you did not request this password reset, please contact your system administrator immediately.</p>
                
                <p>Best regards,<br>
                <strong>DQMS Administration Team</strong></p>
            </div>
            
            <div class="footer">
                <p>This is an automated message from the Digital Queue Management System.<br>
                Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    `
  }

  private createManagerPasswordResetText(resetData: ManagerPasswordReset): string {
    return `
DQMS Password Reset Notification

Hello ${resetData.managerName},

Your RTOM account password for the ${resetData.regionName} region has been reset by the system administrator.

NEW LOGIN CREDENTIALS:
======================
Email: ${resetData.managerEmail}
New Password: ${resetData.newPassword}

Login URL: ${resetData.loginUrl}

NEXT STEPS:
1. Visit the manager portal
2. Log in using your email and new password
3. Continue managing your regional operations

NOTE: If you did not request this password reset, please contact your system administrator immediately.

Best regards,
DQMS Administration Team

---
This is an automated message from the Digital Queue Management System.
Please do not reply to this email.
    `
  }

  private createTeleshopManagerWelcomeTemplate(credentials: TeleshopManagerCredentials): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
            .credentials-box { background: white; border: 2px solid #e9ecef; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .credential-item { margin: 10px 0; padding: 10px; background: #f0fdf4; border-radius: 5px; border-left: 4px solid #10b981; }
            .mobile { font-family: monospace; font-size: 18px; font-weight: bold; color: #059669; }
            .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Welcome to DQMS!</h1>
                <p>Your Teleshop Manager Account is Ready</p>
            </div>
            
            <div class="content">
                <h2>Hello ${credentials.managerName},</h2>
                
                <p>Congratulations! Your Teleshop Manager account has been successfully created for the <strong>${credentials.regionName}</strong> region in our Digital Queue Management System.</p>
                
                <div class="credentials-box">
                    <h3>Your Login Credentials</h3>
                    <div class="credential-item">
                        <strong>Mobile Number:</strong> <span class="mobile">${credentials.managerMobile}</span>
                    </div>
                    <div class="credential-item">
                        <strong>Note:</strong> Simply use your mobile number to log in - no password required
                    </div>
                </div>
                
                <a href="https://digital-queue-management-platform.vercel.app/teleshop-manager/login" class="button">Login to Your Account</a>
                
                <h3>Next Steps:</h3>
                <ol>
                    <li>Click the login button above or visit the Teleshop Manager portal</li>
                    <li>Log in using your mobile number</li>
                    <li>Start managing your officers and outlets</li>
                </ol>
                
                <h3>Your Responsibilities:</h3>
                <ul>
                    <li>Manage officers in your assigned outlets</li>
                    <li>Monitor queue performance at your locations</li>
                    <li>Coordinate with officers for smooth operations</li>
                    <li>Report to your Regional RTOM for regional coordination</li>
                </ul>
                
                <p>If you have any questions or need assistance, please contact your Regional RTOM or system administrator.</p>
                
                <p>Welcome to the team!<br>
                <strong>DQMS Administration Team</strong></p>
            </div>
            
            <div class="footer">
                <p>This is an automated message from the Digital Queue Management System.<br>
                Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    `
  }

  private createTeleshopManagerWelcomeText(credentials: TeleshopManagerCredentials): string {
    return `
Welcome to DQMS - Digital Queue Management System

Hello ${credentials.managerName},

Congratulations! Your Teleshop Manager account has been successfully created for the ${credentials.regionName} region.

LOGIN CREDENTIALS:
==================
Mobile Number: ${credentials.managerMobile}
Note: Simply use your mobile number to log in - no password required

Login URL: https://digital-queue-management-platform.vercel.app/teleshop-manager/login

NEXT STEPS:
1. Visit the Teleshop Manager portal
2. Log in using your mobile number
3. Start managing your officers and outlets

YOUR RESPONSIBILITIES:
- Manage officers in your assigned outlets
- Monitor queue performance at your locations
- Coordinate with officers for smooth operations
- Report to your Regional RTOM for regional coordination

If you have any questions or need assistance, please contact your Regional RTOM or system administrator.

Welcome to the team!
DQMS Administration Team

---
This is an automated message from the Digital Queue Management System.
Please do not reply to this email.
    `
  }

  private createStaffWelcomeTemplate(credentials: StaffWelcomeCredentials): string {
    const locationInfo = credentials.outletName ? ` for <strong>${credentials.outletName}</strong>` :
      credentials.regionName ? ` for the <strong>${credentials.regionName}</strong> region` : '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f1f5f9; }
            .container { max-width: 600px; margin: 40px auto; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); background-color: #ffffff; }
            .header { background: linear-gradient(135deg, #0056b3 0%, #003d80 100%); color: white; padding: 40px 20px; text-align: center; }
            .content { padding: 40px; }
            .credentials-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 24px; margin: 24px 0; border-radius: 12px; }
            .credential-item { margin: 12px 0; font-size: 16px; color: #334155; }
            .credential-label { font-weight: 600; color: #64748b; width: 140px; display: inline-block; }
            .credential-value { font-weight: 700; color: #0f172a; }
            .button { display: inline-block; background: #0056b3; color: white !important; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 24px 0; font-size: 16px; transition: background 0.3s ease; }
            .footer { text-align: center; padding: 30px; color: #64748b; font-size: 13px; background: #f8fafc; border-top: 1px solid #f1f5f9; }
            .login-instruction { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 4px; font-size: 15px; color: #92400e; }
            h1 { margin: 0; font-size: 32px; letter-spacing: -0.5px; }
            h2 { color: #0f172a; margin-top: 0; font-size: 24px; }
            p { margin-bottom: 16px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>SLT-MOBITEL</h1>
                <p style="margin-top: 8px; opacity: 0.9; font-size: 18px;">Digital Queue Management System (DQMS)</p>
            </div>
            
            <div class="content">
                <h2>Welcome to the Team, ${credentials.name}</h2>
                <p>We are pleased to inform you that your professional account as a <strong>${credentials.role}</strong>${locationInfo} has been successfully configured and is now ready for use.</p>
                
                <div class="credentials-box">
                    <p style="margin-top: 0; font-weight: bold; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 16px; color: #475569; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em;">Access Credentials</p>
                    <div class="credential-item"><span class="credential-label">Mobile Number:</span> <span class="credential-value">${credentials.mobileNumber}</span></div>
                    <div class="credential-item"><span class="credential-label">Login Method:</span> <span class="credential-value">Secure OTP Verification</span></div>
                    <div class="credential-item"><span class="credential-label">Password:</span> <span class="credential-value">Not Required</span></div>
                </div>
                
                <div class="login-instruction">
                    <strong>Secure Login Instructions:</strong><br>
                    To access the system, follow these steps:
                    <ol style="margin-bottom: 0; margin-top: 8px; padding-left: 20px;">
                        <li>Click the access button below to visit the portal.</li>
                        <li>Enter your registered mobile number (${credentials.mobileNumber}).</li>
                        <li>You will receive a 4-digit One-Time Password (OTP) via SMS.</li>
                        <li>Enter the OTP to securely verify your identity.</li>
                    </ol>
                </div>
                
                <p style="text-align: center;">
                    <a href="${credentials.loginUrl}" class="button">Log In to Dashboard</a>
                </p>
                
                <p style="font-size: 14px; color: #64748b; font-style: italic;">Note: This system uses advanced security protocols; please do not share your OTP with anyone.</p>
                
                <p style="margin-top: 32px;">Should you encounter any difficulties or require further assistance, please contact the IT Support Helpdesk.</p>
                
                <p>Best regards,<br>
                <strong style="color: #0056b3;">SLT-MOBITEL</strong></p>
            </div>
            
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} Sri Lanka Telecom PLC. All rights reserved.<br>
                This is a system-generated notification. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    `
  }

  private createStaffWelcomeText(credentials: StaffWelcomeCredentials): string {
    const locationInfo = credentials.outletName ? ` for ${credentials.outletName}` :
      credentials.regionName ? ` for the ${credentials.regionName} region` : '';

    return `
SLT-MOBITEL | Digital Queue Management System (DQMS)

Official Welcome Notification

Dear ${credentials.name},

Your account as a ${credentials.role}${locationInfo} has been successfully created in the SLT-MOBITEL DQMS Portal.

ACCESS DETAILS:
==================
Registered Mobile: ${credentials.mobileNumber}
Login Method: Secure OTP (One-Time Password)
Password Required: No

HOW TO LOG IN:
1. Visit the portal at: ${credentials.loginUrl}
2. Enter your registered mobile number.
3. A 4-digit OTP will be sent to your phone via SMS.
4. Enter the OTP to access your dashboard.

SECURITY NOTICE:
Your access is strictly for authorized personnel. Please do not share your mobile verification codes with anyone.

For technical support, please contact the system administrator.

Best regards,
SLT-MOBITEL
    `
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify()
      console.log('SMTP connection verified successfully')
      return true
    } catch (error) {
      console.error('SMTP connection failed:', error)
      return false
    }
  }
}

export default new EmailService()