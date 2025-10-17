import nodemailer from 'nodemailer'

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
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎉 Welcome to DQMS!</h1>
                <p>Your Regional Manager Account is Ready</p>
            </div>
            
            <div class="content">
                <h2>Hello ${credentials.managerName},</h2>
                
                <p>Congratulations! Your Regional Manager account has been successfully created for the <strong>${credentials.regionName}</strong> region in our Digital Queue Management System.</p>
                
                <div class="credentials-box">
                    <h3>🔐 Your Login Credentials</h3>
                    <div class="credential-item">
                        <strong>Email:</strong> ${credentials.managerEmail}
                    </div>
                    <div class="credential-item">
                        <strong>Temporary Password:</strong> 
                        <span class="password">${credentials.temporaryPassword}</span>
                    </div>
                </div>
                
                <div class="warning">
                    <strong>🚨 Important Security Notice:</strong><br>
                    This is a temporary password. For security reasons, please log in and change your password immediately after your first login.
                </div>
                
                <a href="${credentials.loginUrl}" class="button">🚀 Login to Your Account</a>
                
                <h3>📋 Next Steps:</h3>
                <ol>
                    <li>Click the login button above or visit the manager portal</li>
                    <li>Log in using your email and temporary password</li>
                    <li><strong>Change your password immediately</strong></li>
                    <li>Start managing your regional operations</li>
                </ol>
                
                <h3>🎯 Your Responsibilities:</h3>
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
Temporary Password: ${credentials.temporaryPassword}

IMPORTANT SECURITY NOTICE:
This is a temporary password. Please log in and change your password immediately for security reasons.

Login URL: ${credentials.loginUrl}

NEXT STEPS:
1. Visit the manager portal
2. Log in using your email and temporary password  
3. Change your password immediately
4. Start managing your regional operations

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