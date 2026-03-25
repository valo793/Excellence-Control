// server/mailer.js
import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
} = process.env;

let transporter = null;

if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
} else {
  console.warn('[MAILER] SMTP não configurado. E-mails serão só logados no console.');
}

export async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log('=== EMAIL (DEV MODE - NÃO ENVIADO) ===');
    console.log('Para:', to);
    console.log('Assunto:', subject);
    console.log('Texto:', text);
    if (html) console.log('HTML:', html);
    console.log('=======================================');
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject,
    text,
    html: html || text,
  });
}
