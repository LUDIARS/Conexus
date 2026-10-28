import nodemailer from 'nodemailer';
import { connect, type TLSSocket } from 'node:tls';
import { secret } from '../config.js';
import { BoundaryError, DeliveryError } from '../errors.js';
import type { SendMessage } from '../ports.js';

/** @implements NX-EMAIL-01 NX-EMAIL-03 — authenticated TLS, fixed recipient, no file/URL access. */
export const emailSend: SendMessage = async (bot, destination, command, id) => {
  if (bot.platform !== 'email' || !bot.smtp || command.operation !== 'send' || !command.subject) throw new BoundaryError('email_contract_invalid');
  const smtp = bot.smtp;
  let socket: TLSSocket | undefined;
  const transport = nodemailer.createTransport({
    host: bot.smtp.host, port: 465, secure: true,
    auth: { user: bot.smtp.user, pass: secret(bot.tokenEnv) },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 10000, greetingTimeout: 5000, socketTimeout: 10000,
    dnsTimeout: 3000, disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false,
    getSocket: (_options, callback) => {
      let returned = false;
      socket = connect({ host: smtp.host, port: 465, servername: smtp.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
      socket.once('error', error => { if (!returned) { returned = true; callback(error); } });
      socket.once('secureConnect', () => { if (!returned && socket) { returned = true; callback(null, { connection: socket, secured: true }); } });
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { socket?.destroy(new Error('deadline')); transport.close(); reject(new DeliveryError('email_result_unknown', undefined, true)); }, 20000);
    });
    const result = await Promise.race([transport.sendMail({
      from: bot.smtp.from, to: destination, subject: command.subject, text: command.text,
      envelope: { from: bot.smtp.from, to: [destination] },
      messageId: `<${id}@${bot.smtp.from.split('@')[1]}>`,
      disableFileAccess: true, disableUrlAccess: true,
    }), deadline]);
    if (result.rejected.length || result.accepted.length !== 1) throw new DeliveryError('email_recipient_rejected');
    return id;
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError('email_result_unknown', undefined, true);
  } finally { if (timer) clearTimeout(timer); socket?.destroy(); transport.close(); }
};
