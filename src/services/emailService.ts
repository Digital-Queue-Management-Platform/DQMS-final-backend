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
  regionName: string
  temporaryPassword: string
  loginUrl: string
}

interface ManagerPasswordReset {
  managerName: string
  managerEmail: string
  regionName: string
  newPassword: string
  loginUrl: string
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
        subject: `Welcome to DQMS - Your Regional Manager Account for ${credentials.regionName}`,
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
                <p>Your Regional Manager Account is Ready</p>
            </div>
            
            <div class="content">
                <h2>Hello ${credentials.managerName},</h2>
                
                <p>Congratulations! Your Regional Manager account has been successfully created for the <strong>${credentials.regionName}</strong> region in our Digital Queue Management System.</p>
                
                <div class="credentials-box">
                    <h3>Your Login Credentials</h3>
                    <div class="credential-item">
                        <strong>Email:</strong> ${credentials.managerEmail}
                    </div>
                    <div class="credential-item">
                        <strong>Password:</strong> 
                        <span class="password">${credentials.temporaryPassword}</span>
                    </div>
                </div>
                
                <a href="https://digital-queue-management-platform.vercel.app/manager/login" class="button">Login to Your Account</a>
                
                <h3>Next Steps:</h3>
                <ol>
                    <li>Click the login button above or visit the manager portal</li>
                    <li>Log in using your email and password</li>
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

Congratulations! Your Regional Manager account has been successfully created for the ${credentials.regionName} region.

LOGIN CREDENTIALS:
==================
Email: ${credentials.managerEmail}
Password: ${credentials.temporaryPassword}

Login URL: https://digital-queue-management-platform.vercel.app/manager/login

NEXT STEPS:
1. Visit the manager portal
2. Log in using your email and password
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
                
                <p>Your Regional Manager account password for the <strong>${resetData.regionName}</strong> region has been reset by the system administrator.</p>
                
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

Your Regional Manager account password for the ${resetData.regionName} region has been reset by the system administrator.

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