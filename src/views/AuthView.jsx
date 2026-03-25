import { useState } from 'react';
import {
  registerUser,
  loginUser,
  getCurrentUser,
  forgotPassword,
  resetPassword,
  resendVerificationEmail,
} from '../config/oracle';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  Info,
  Target,
  Settings,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { ui } from '../ui/visuals';
import dpWorldLogo from '../assets/DPWorldLogo.png';

function InputWithIcon({ icon: Icon, id, label, error, ...props }) {
  const isPasswordField = props?.type === 'password';
  const [showPassword, setShowPassword] = useState(false);
  const inputType = isPasswordField ? (showPassword ? 'text' : 'password') : props?.type;

  return (
    <div className="space-y-1.5">
      {label ? <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</label> : null}
      <div className="relative with-leading-icon">
        <Icon className="leading-icon w-[18px] h-[18px] text-muted-foreground" />
        <input
          id={id}
          aria-invalid={error ? 'true' : undefined}
          {...props}
          type={inputType}
          className={`${ui.field.input} with-leading-icon-input ${isPasswordField ? 'has-trailing-toggle' : ''} ${error ? 'is-error' : ''}`}
        />
        {isPasswordField ? (
          <button
            type="button"
            className="trailing-icon-button"
            onClick={() => setShowPassword(prev => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="w-[16px] h-[16px]" /> : <Eye className="w-[16px] h-[16px]" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-destructive flex items-center gap-1">
          <Info className="w-[14px] h-[14px]" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function AuthView({ onAuthSuccess, onOpenSettings, language = 'en' }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [generalError, setGeneralError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');

  const [forgotStep, setForgotStep] = useState(1);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const isPtBr = language === 'pt-BR';
  const tr = (enText, ptBrText) => (isPtBr ? ptBrText : enText);
  const emailRegex = /\S+@\S+\.\S+/;

  function resetMessages() {
    setErrors({});
    setGeneralError('');
    setSuccessMsg('');
  }

  function validateMainForm() {
    if (mode === 'forgot') return true;

    const nextErrors = {};
    if (!email) nextErrors.email = tr('E-mail is required.', 'E-mail obrigatorio.');
    else if (!emailRegex.test(email)) nextErrors.email = tr('Invalid e-mail.', 'E-mail invalido.');

    if (!password) nextErrors.password = tr('Password is required.', 'Senha obrigatoria.');
    else if (password.length < 8) {
      nextErrors.password = tr('Password must contain at least 8 characters.', 'A senha precisa ter no minimo 8 caracteres.');
    }

    if (mode === 'register' && !name) {
      nextErrors.name = tr('Full name is required.', 'Nome completo obrigatorio.');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleResendVerification(customEmail) {
    const targetEmail = (customEmail || pendingVerificationEmail || email || '').trim().toLowerCase();
    if (!targetEmail || !emailRegex.test(targetEmail)) {
      setErrors({ email: tr('Provide a valid e-mail to resend verification.', 'Informe um e-mail valido para reenviar a verificacao.') });
      return;
    }

    setLoading(true);
    try {
      await resendVerificationEmail({ email: targetEmail });
      setSuccessMsg(
        tr(
          'If the account exists and is eligible, a verification e-mail has been sent.',
          'Se a conta existir e estiver elegivel, um e-mail de verificacao foi enviado.',
        ),
      );
      setGeneralError('');
      setPendingVerificationEmail(targetEmail);
    } catch (err) {
      setGeneralError(err.message || tr('Could not resend verification e-mail.', 'Nao foi possivel reenviar o e-mail de verificacao.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();

    if (mode === 'login' || mode === 'register') {
      if (!validateMainForm()) return;
      setLoading(true);

      try {
        if (mode === 'register') {
          const registerResult = await registerUser({ email, name, password });

          if (registerResult?.verificationRequired) {
            setMode('registerSuccess');
            setPendingVerificationEmail(String(email).trim().toLowerCase());
            setNeedsVerification(true);
            setPassword('');
            setRememberMe(false);
            setSuccessMsg(
              tr(
                'Account created. Check your e-mail to verify your account before login.',
                'Conta criada. Verifique seu e-mail para validar sua conta antes do login.',
              ),
            );
            return;
          }
        } else {
          await loginUser({ email, password, rememberMe });
        }

        const me = await getCurrentUser();
        onAuthSuccess(me);
      } catch (err) {
        if (mode === 'login' && err?.code === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(true);
          setPendingVerificationEmail(String(email).trim().toLowerCase());
        } else {
          setNeedsVerification(false);
        }
        setGeneralError(err.message || tr('An error occurred. Please try again.', 'Ocorreu um erro. Tente novamente.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (forgotStep === 1) {
      const nextErrors = {};
      if (!email) nextErrors.email = tr('E-mail is required.', 'E-mail obrigatorio.');
      else if (!emailRegex.test(email)) nextErrors.email = tr('Invalid e-mail.', 'E-mail invalido.');
      if (Object.keys(nextErrors).length) {
        setErrors(nextErrors);
        return;
      }

      setLoading(true);
      try {
        await forgotPassword({ email });
        setForgotStep(2);
        setSuccessMsg(tr('A verification code was sent to your e-mail.', 'Um codigo foi enviado para seu e-mail.'));
      } catch (err) {
        setGeneralError(err.message || tr('Could not send the code.', 'Nao foi possivel enviar o codigo.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    const nextErrors = {};
    if (!resetCode) nextErrors.resetCode = tr('Code is required.', 'Codigo obrigatorio.');
    if (!newPassword) nextErrors.newPassword = tr('New password is required.', 'Nova senha obrigatoria.');
    else if (newPassword.length < 8) nextErrors.newPassword = tr('Password must contain at least 8 characters.', 'A senha precisa ter no minimo 8 caracteres.');
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ email, token: resetCode, password: newPassword });
      setSuccessMsg(tr('Password reset completed. You can now login.', 'Senha redefinida com sucesso. Voce ja pode fazer login.'));
      setMode('login');
      setForgotStep(1);
      setPassword('');
      setResetCode('');
      setNewPassword('');
    } catch (err) {
      setGeneralError(err.message || tr('Could not reset password.', 'Nao foi possivel redefinir a senha.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    resetMessages();
    const nextErrors = {};
    if (!email) nextErrors.email = tr('E-mail is required.', 'E-mail obrigatorio.');
    else if (!emailRegex.test(email)) nextErrors.email = tr('Invalid e-mail.', 'E-mail invalido.');
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      await forgotPassword({ email });
      setSuccessMsg(tr('A new verification code has been sent.', 'Um novo codigo foi enviado.'));
    } catch (err) {
      setGeneralError(err.message || tr('Could not resend the code.', 'Nao foi possivel reenviar o codigo.'));
    } finally {
      setLoading(false);
    }
  }

  function goToLogin() {
    setMode('login');
    setForgotStep(1);
    setNeedsVerification(false);
    setRememberMe(false);
    resetMessages();
    setResetCode('');
    setNewPassword('');
  }

  return (
    <div className={`${ui.shell.appBackdrop} auth-shell auth-market-shell auth-overhaul-shell min-h-screen page-screen-stage`}>
      <div className="auth-overhaul-frame relative z-[2] w-full min-h-screen grid overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
        <aside className="auth-overhaul-brand order-2 lg:order-1 px-7 py-8 sm:px-10 sm:py-10">
          <div className="auth-overhaul-brand-wrap">
            <div className="auth-brand-logo-wrap">
              <img src={dpWorldLogo} alt="DP World Logo" className="auth-brand-logo-static" />
            </div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {tr('Global Trade Control Layer', 'Camada global de controle')}
            </p>
            <h2 className="text-3xl lg:text-4xl font-semibold leading-tight text-foreground">
              {tr('Operate faster without losing governance.', 'Opere mais rapido sem perder governanca.')}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {tr(
                'One workspace for board, roadmap and analytics. Built for operational teams that need clean signals and execution discipline.',
                'Um workspace para board, cronograma e analytics. Feito para times operacionais que precisam de sinal limpo e disciplina de execução.',
              )}
            </p>
          </div>

          <ul className="auth-overhaul-stat-list">
            <li>
              <span>32+</span>
              <p>{tr('Active projects in command lanes', 'Projetos ativos nas esteiras de comando')}</p>
            </li>
            <li>
              <span>R$ 2.4M</span>
              <p>{tr('Estimated portfolio gains', 'Ganhos estimados do portfolio')}</p>
            </li>
            <li>
              <span>97%</span>
              <p>{tr('Tracked initiatives with accountable owners', 'Iniciativas rastreadas com dono accountable')}</p>
            </li>
          </ul>
          <p className="kpi-disclaimer">
            {tr(
              '* KPI values shown above are illustrative only.',
              '* Os valores de KPI exibidos acima são meramente ilustrativos.',
            )}
          </p>

          <p className="auth-overhaul-brand-note">
            {tr('Portfolio visibility, timeline control and governance in one calm workspace.', 'Visibilidade de portfolio, controle de cronograma e governanca em um workspace limpo.')}
          </p>
        </aside>

        <section className="auth-overhaul-form order-1 lg:order-2 px-7 py-8 sm:px-10 sm:py-10 flex flex-col items-center justify-center relative">
          <div className="absolute right-7 top-8 z-10 sm:right-10 sm:top-10">
            <button
              type="button"
              onClick={onOpenSettings}
              className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost} border border-border/75 bg-card/60 backdrop-blur-sm`}
              title={tr('Settings', 'Configuracoes')}
            >
              <Settings className="w-[18px] h-[18px]" />
            </button>
          </div>

          <div className="w-full max-w-[40rem] lg:mx-auto auth-form-market-card auth-overhaul-card">
            <h1 className="text-3xl font-semibold text-foreground">Excellence Control</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              {tr('Access the control room and keep execution lanes synchronized.', 'Acesse a sala de controle e mantenha as esteiras de execução sincronizadas.')}
            </p>

            {!['forgot', 'registerSuccess'].includes(mode) ? (
              <div className="auth-mode-toggle mt-6 p-1 rounded-xl bg-muted/45 border border-border/75 flex">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setForgotStep(1);
                    setNeedsVerification(false);
                    resetMessages();
                  }}
                  className={`auth-mode-btn flex-1 ${ui.button.base} ${mode === 'login' ? ui.button.primary : ui.button.ghost}`}
                >
                  {tr('Login', 'Login')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setForgotStep(1);
                    setNeedsVerification(false);
                    resetMessages();
                  }}
                  className={`auth-mode-btn flex-1 ${ui.button.base} ${mode === 'register' ? ui.button.primary : ui.button.ghost}`}
                >
                  {tr('Register', 'Registrar')}
                </button>
              </div>
            ) : null}

            {mode === 'forgot' ? (
              <div className="mt-6">
                <h2 className="text-lg font-semibold">{tr('Recover access', 'Recuperar acesso')}</h2>
                <p className="text-xs text-muted-foreground">{tr('Type your e-mail to receive a reset code.', 'Informe seu e-mail para receber o codigo de redefinicao.')}</p>
              </div>
            ) : null}

            {mode === 'registerSuccess' ? (
              <div className="mt-7 space-y-5">
                <div className="surface-card p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mt-0.5" />
                    <div className="space-y-1.5">
                      <h2 className="text-lg font-semibold text-foreground">{tr('Account created. Verify your e-mail.', 'Conta criada. Verifique seu e-mail.')}</h2>
                      <p className="text-sm text-muted-foreground">
                        {tr(
                          'A verification link was sent. You must verify your account before the first login.',
                          'Um link de verificacao foi enviado. Voce precisa validar a conta antes do primeiro login.',
                        )}
                      </p>
                      {pendingVerificationEmail ? (
                        <p className="text-xs text-muted-foreground">
                          {tr('E-mail:', 'E-mail:')} <span className="font-semibold text-foreground">{pendingVerificationEmail}</span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {successMsg ? <div className="text-sm text-emerald-500">{successMsg}</div> : null}
                {generalError ? <div className="text-sm text-destructive">{generalError}</div> : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleResendVerification(pendingVerificationEmail)}
                    className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
                  >
                    {loading ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <RefreshCw className="w-[16px] h-[16px]" />}
                    {tr('Resend verification e-mail', 'Reenviar e-mail de verificacao')}
                  </button>
                  <button type="button" onClick={goToLogin} className={`${ui.button.base} ${ui.button.primary}`}>
                    {tr('Go to login', 'Ir para login')}
                    <ArrowRight className="w-[16px] h-[16px]" />
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {(mode === 'login' || mode === 'register') ? (
                  <>
                    {mode === 'register' ? (
                      <InputWithIcon
                        id="name"
                        label={tr('Full name', 'Nome completo')}
                        icon={User}
                        type="text"
                        placeholder={tr('Your full name', 'Seu nome completo')}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        error={errors.name}
                      />
                    ) : null}

                    <InputWithIcon
                      id="email"
                      label="E-mail"
                      icon={Mail}
                      type="email"
                      placeholder="name.surname@dpworld.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      error={errors.email}
                    />

                    <InputWithIcon
                      id="password"
                      label={tr('Password', 'Senha')}
                      icon={Lock}
                      type="password"
                      placeholder={tr('At least 8 characters', 'No minimo 8 caracteres')}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      error={errors.password}
                      minLength={8}
                    />

                    {mode === 'login' ? (
                      <label className="surface-muted rounded-xl px-3.5 py-3 flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={e => setRememberMe(e.target.checked)}
                          className="choice-control mt-0.5"
                        />
                        <span className="text-xs text-muted-foreground leading-relaxed">
                          <span className="font-semibold text-foreground">{tr('Keep me signed in', 'Permanecer conectado')}</span>
                          <br />
                          {tr('Use only on trusted devices.', 'Use apenas em dispositivos confiaveis.')}
                        </span>
                      </label>
                    ) : null}
                  </>
                ) : null}

                {mode === 'forgot' ? (
                  <>
                    <InputWithIcon
                      id="email"
                      label={tr('Registered e-mail', 'E-mail cadastrado')}
                      icon={Mail}
                      type="email"
                      placeholder="name.surname@dpworld.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      error={errors.email}
                    />

                    {forgotStep === 2 ? (
                      <>
                        <InputWithIcon
                          id="resetCode"
                          label={tr('Code sent by e-mail', 'Codigo recebido por e-mail')}
                          icon={Target}
                          type="text"
                          placeholder="Ex: 123456"
                          value={resetCode}
                          onChange={e => setResetCode(e.target.value)}
                          error={errors.resetCode}
                        />
                        <InputWithIcon
                          id="newPassword"
                          label={tr('New password', 'Nova senha')}
                          icon={Lock}
                          type="password"
                          placeholder={tr('At least 8 characters', 'No minimo 8 caracteres')}
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          error={errors.newPassword}
                          minLength={8}
                        />
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <span>{tr("Didn't receive the code?", 'Nao recebeu o codigo?')}</span>
                          <button type="button" onClick={handleResendCode} disabled={loading} className="text-primary hover:underline disabled:opacity-60">
                            {tr('Resend code', 'Reenviar codigo')}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}

                {generalError ? <div className="text-sm text-destructive">{generalError}</div> : null}
                {successMsg && !generalError ? <div className="text-sm text-emerald-500">{successMsg}</div> : null}

                {needsVerification && mode === 'login' ? (
                  <div className="surface-muted rounded-xl px-3 py-2.5 text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span>{tr('Your account is not verified yet.', 'Sua conta ainda nao foi verificada.')}</span>
                    <button
                      type="button"
                      onClick={() => handleResendVerification(pendingVerificationEmail || email)}
                      disabled={loading}
                      className="text-primary font-semibold hover:underline disabled:opacity-60"
                    >
                      {tr('Resend e-mail', 'Reenviar e-mail')}
                    </button>
                  </div>
                ) : null}

                <button type="submit" disabled={loading} className={`auth-submit-btn w-full ${ui.button.base} ${ui.button.primary} mt-3 py-3 disabled:opacity-60`}>
                  {loading ? (
                    <>
                      <Loader2 className="w-[18px] h-[18px] animate-spin" />
                      {tr('Loading...', 'Carregando...')}
                    </>
                  ) : (
                    <>
                      {mode === 'login' && tr('Login to platform', 'Entrar na plataforma')}
                      {mode === 'register' && tr('Create account', 'Criar conta')}
                      {mode === 'forgot' && (forgotStep === 1 ? tr('Send code', 'Enviar codigo') : tr('Reset password', 'Redefinir senha'))}
                      <ArrowRight className="w-[18px] h-[18px]" />
                    </>
                  )}
                </button>
              </form>
            )}

            {mode === 'login' ? (
              <p className="mt-5 text-sm text-muted-foreground">
                {tr('Forgot your password?', 'Esqueceu sua senha?')}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setForgotStep(1);
                    resetMessages();
                    setPassword('');
                  }}
                  className="text-primary hover:underline"
                >
                  {tr('Recover access', 'Recuperar acesso')}
                </button>
              </p>
            ) : null}

            {mode === 'forgot' ? (
              <p className="mt-5 text-xs text-muted-foreground">
                {tr('Remembered your password?', 'Lembrou sua senha?')}{' '}
                <button type="button" onClick={goToLogin} className="text-primary hover:underline">
                  {tr('Back to login', 'Voltar para login')}
                </button>
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
