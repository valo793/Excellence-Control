import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, ArrowRight, Mail, Settings } from 'lucide-react';
import { resendVerificationEmail, verifyEmailToken } from '../config/oracle';
import { ui } from '../ui/visuals';
import dpWorldLogo from '../assets/DPWorldLogo.png';

const STATE_MAP = {
  verifying: { tone: 'text-muted-foreground', icon: Loader2 },
  success: { tone: 'text-emerald-600 dark:text-emerald-300', icon: CheckCircle2 },
  already: { tone: 'text-emerald-600 dark:text-emerald-300', icon: CheckCircle2 },
  expired: { tone: 'text-amber-600 dark:text-amber-300', icon: AlertTriangle },
  used: { tone: 'text-amber-600 dark:text-amber-300', icon: AlertTriangle },
  invalid: { tone: 'text-rose-600 dark:text-rose-300', icon: AlertTriangle },
  unavailable: { tone: 'text-rose-600 dark:text-rose-300', icon: AlertTriangle },
  error: { tone: 'text-rose-600 dark:text-rose-300', icon: AlertTriangle },
};

export default function VerifyEmailView({ token, onGoToLogin, onOpenSettings, language = 'en' }) {
  const [state, setState] = useState('verifying');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');

  const isPtBr = language === 'pt-BR';
  const tr = (enText, ptBrText) => (isPtBr ? ptBrText : enText);

  const stateConfig = useMemo(() => STATE_MAP[state] || STATE_MAP.error, [state]);
  const StateIcon = stateConfig.icon;

  useEffect(() => {
    let active = true;

    async function runVerification() {
      if (!token) {
        if (!active) return;
        setState('invalid');
        setMessage(tr('Missing verification token.', 'Token de verificação ausente.'));
        return;
      }

      setState('verifying');
      setMessage(tr('Verifying your account...', 'Validando sua conta...'));

      try {
        const data = await verifyEmailToken(token);
        if (!active) return;

        if (data?.status === 'ALREADY_VERIFIED') {
          setState('already');
          setMessage(tr('This account is already verified.', 'Esta conta já está verificada.'));
          return;
        }

        setState('success');
        setMessage(tr('E-mail verified successfully. You can now login.', 'E-mail verificado com sucesso. Você já pode fazer login.'));
      } catch (err) {
        if (!active) return;
        switch (err?.code) {
          case 'TOKEN_EXPIRED':
            setState('expired');
            setMessage(tr('Verification link expired. Request a new e-mail below.', 'Link expirado. Solicite um novo e-mail abaixo.'));
            break;
          case 'LINK_ALREADY_USED':
            setState('used');
            setMessage(tr('This verification link has already been used.', 'Este link de verificação já foi utilizado.'));
            break;
          case 'SCHEMA_NOT_READY':
            setState('unavailable');
            setMessage(tr('Verification flow is not configured yet. Run the server migration.', 'Fluxo de verificação ainda não configurado. Rode a migração do servidor.'));
            break;
          case 'INVALID_TOKEN':
            setState('invalid');
            setMessage(tr('Invalid verification link.', 'Link de verificação inválido.'));
            break;
          default:
            setState('error');
            setMessage(err.message || tr('Could not verify e-mail right now.', 'Não foi possível verificar o e-mail agora.'));
            break;
        }
      }
    }

    runVerification();
    return () => {
      active = false;
    };
  }, [token, language]);

  async function handleResend() {
    setResendError('');
    setResendMessage('');
    const parsedEmail = String(email || '').trim().toLowerCase();
    const emailRegex = /\S+@\S+\.\S+/;

    if (!parsedEmail || !emailRegex.test(parsedEmail)) {
      setResendError(tr('Provide a valid e-mail address.', 'Informe um e-mail válido.'));
      return;
    }

    setResendLoading(true);
    try {
      await resendVerificationEmail({ email: parsedEmail });
      setResendMessage(
        tr(
          'If the account exists and is eligible, a verification e-mail has been sent.',
          'Se a conta existir e estiver elegível, um e-mail de verificação foi enviado.',
        ),
      );
    } catch (err) {
      setResendError(err.message || tr('Could not resend verification e-mail.', 'Não foi possível reenviar o e-mail de verificação.'));
    } finally {
      setResendLoading(false);
    }
  }

  const showResend = ['expired', 'invalid', 'used', 'error'].includes(state);

  return (
    <div className={`${ui.shell.appBackdrop} auth-shell min-h-screen flex items-center justify-center p-4 page-screen-stage`}>
      <div className="verify-shell-card relative z-[2] w-full max-w-lg frame-elevated-shadow p-6 sm:p-7">
        <button
          type="button"
          onClick={onOpenSettings}
          className={`absolute top-4 right-4 ${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`}
          title={tr('Settings', 'Configurações')}
        >
          <Settings className="w-[18px] h-[18px]" />
        </button>

        <div className="pr-12">
          <div className="mb-3 flex items-center gap-2">
            <img src={dpWorldLogo} alt="DP World" className="h-8 w-auto" />
          </div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{tr('Account Verification', 'Verificação de Conta')}</p>
          <h1 className="text-2xl font-semibold text-foreground mt-1">Excellence Control</h1>
        </div>

        <div className={`mt-6 flex items-start gap-3 ${stateConfig.tone}`}>
          <StateIcon className={`w-6 h-6 mt-0.5 ${state === 'verifying' ? 'animate-spin' : ''}`} />
          <p className="text-sm leading-relaxed">{message}</p>
        </div>

        {showResend && (
          <div className="mt-6 surface-card p-4 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {tr('Resend verification e-mail', 'Reenviar e-mail de verificação')}
            </label>
            <div className="relative with-leading-icon">
              <Mail className="leading-icon w-[18px] h-[18px] text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name.surname@dpworld.com"
                className={`${ui.field.input} with-leading-icon-input`}
              />
            </div>
            {resendError && <p className="text-xs text-destructive">{resendError}</p>}
            {resendMessage && <p className="text-xs text-emerald-500">{resendMessage}</p>}
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading}
              className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
            >
              {resendLoading ? <Loader2 className="w-[16px] h-[16px] animate-spin" /> : <RefreshCw className="w-[16px] h-[16px]" />}
              {tr('Send verification e-mail', 'Enviar e-mail de verificação')}
            </button>
          </div>
        )}

        <div className="mt-6">
          <button type="button" onClick={onGoToLogin} className={`${ui.button.base} ${ui.button.primary}`}>
            {tr('Go to login', 'Ir para login')}
            <ArrowRight className="w-[16px] h-[16px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

