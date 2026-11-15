import { useStore } from '../state/store';
import { useEffect, useState } from 'react';

import { ipc, isDesktop, type CredentialSummary, type CredentialUse, type VaultStatus } from '../lib/ipc';
import { dtg } from '../lib/dtg';
import { t } from '../i18n';

/**
 * Saved credentials, and the passphrase that protects them.
 *
 * Credentials are encrypted with a key derived from a passphrase that is never
 * stored, so forgetting it means re-entering them — there is no recovery path,
 * because a recovery path is a second way in.
 *
 * A stored secret is never shown again — not here, not anywhere. It is
 * visible while it is typed; after that the only things to do with it are use
 * it and replace it.
 *
 * `scope` is where this is drawn. On the start screen (`machine`) it is the
 * vault alone: its passphrase, its lock, whether this computer opens it. No
 * login is listed there, because a login belongs to a project. Inside a
 * project (`project`) it is that project's logins and no other's.
 */
export function VaultSettings({ scope }: { scope: 'machine' | 'project' }) {
  const inProject = scope === 'project';
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The use log, for one credential or all of them.
  const [usage, setUsage] = useState<CredentialUse[] | null>(null);
  const [usageFor, setUsageFor] = useState('');
  const loadUsage = (id: string) => {
    setUsageFor(id);
    void ipc.listCredentialUse(id || undefined).then(setUsage).catch((e: unknown) => setProblem(String(e)));
  };

  // Adding a credential.
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'ssh' | 'snmp' | 'meraki' | 'api'>('ssh');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [secondSecret, setSecondSecret] = useState('');
  // An API login's HTTPS port, kept as its `detail`; blank is 443.
  const [apiPort, setApiPort] = useState('');

  const refresh = () => {
    void ipc.vaultStatus().then(setStatus).catch(() => setStatus(null));
    if (inProject) void ipc.listCredentials().then(setCredentials).catch(() => setCredentials([]));
  };

  // Again whenever a login is saved or deleted anywhere in the project.
  const vaultRevision = useStore((st) => st.vaultRevision);
  useEffect(() => {
    void ipc.vaultStatus().then(setStatus).catch(() => setStatus(null));
    if (inProject) void ipc.listCredentials().then(setCredentials).catch(() => setCredentials([]));
  }, [inProject, vaultRevision]);

  const act = (p: Promise<unknown>, done: string) => {
    setProblem(null);
    void p
      .then(() => {
        setMessage(done);
        setPassphrase('');
        setConfirmPassphrase('');
        refresh();
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };

  const create = () => {
    if (passphrase !== confirmPassphrase) {
      setProblem('The two passphrases do not match.');
      return;
    }
    act(ipc.createVault(passphrase), 'Vault created and unlocked for this session.');
  };

  const save = () => {
    act(
      ipc
        .saveCredential({
          label: label.trim(),
          kind,
          // Only what the kind shows — a Meraki key has no user, and
          // an API login no second secret.
          username: kind === 'meraki' ? '' : username.trim(),
          secret,
          secondSecret: kind === 'ssh' || kind === 'snmp' ? secondSecret || undefined : undefined,
          detail: kind === 'api' && apiPort.trim() ? apiPort.trim() : undefined,
        })
        .then(() => {
          useStore.getState().bumpVault();
          setAdding(false);
          setLabel('');
          setUsername('');
          setSecret('');
          setSecondSecret('');
          setApiPort('');
        }),
      'Saved.',
    );
  };

  if (!isDesktop || !status) return null;

  return (
    <section className="cv-vault">
      <h2>{t('vaultSettings.savedCredentials')}</h2>

      {!status.exists ? (
        <>
          <p className="cv-help">
            Typing credentials for each run is the default and needs nothing set up. A vault is
            for the other case — backing up ninety devices without sitting through it, or not
            retyping the same enable password all day.
          </p>
          <p className="cv-help">
            Credentials are encrypted with a key derived from a passphrase that is never stored. Forget it and you re-enter the credentials; there is no recovery, because a recovery path is a second way in.
          </p>
          <div className="cv-discover-form">
            <label className="cv-field">
              <span>Passphrase (at least {status.minimumPassphrase} characters)</span>
              <input className="cv-input" type="password" value={passphrase} autoComplete="new-password"
                onChange={(e) => setPassphrase(e.target.value)} />
            </label>
            <label className="cv-field">
              <span>{t('vaultSettings.again')}</span>
              <input className="cv-input" type="password" value={confirmPassphrase}
                autoComplete="new-password" onChange={(e) => setConfirmPassphrase(e.target.value)} />
            </label>
            <button type="button" className="cv-btn cv-btn-start" onClick={create}
              disabled={passphrase.length < status.minimumPassphrase}>
              {t('vaultSettings.createVault')}
            </button>
          </div>
        </>
      ) : !status.unlocked ? (
        <>
          <p className="cv-help">
            {inProject ? t('vaultSettings.lockedWith', { count: status.credentials }) : t('vaultSettings.locked')}
          </p>
          <div className="cv-discover-form">
            <label className="cv-field">
              <span>{t('vaultSettings.passphrase')}</span>
              <input className="cv-input" type="password" value={passphrase} autoComplete="current-password"
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && act(ipc.unlockVault(passphrase), 'Unlocked.')} />
            </label>
            <button type="button" className="cv-btn cv-btn-start"
              onClick={() => act(ipc.unlockVault(passphrase), 'Unlocked.')} disabled={!passphrase}>
              Unlock
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="cv-vault-bar">
            <span className="cv-help">
              {inProject ? t('vaultSettings.unlockedWith', { count: credentials.length }) : t('vaultSettings.unlocked')}
            </span>
            <button type="button" className="cv-btn cv-btn-small"
              onClick={() => act(ipc.lockVault(), 'Locked.')}>
              Lock
            </button>
            {/* Opt-in, per machine. */}
            <label className="cv-check cv-check-inline" title={t('vaultSettings.theKeyThatOpens')}>
              <input type="checkbox" checked={Boolean(status.keptInKeychain)}
                onChange={(e) => act(e.target.checked ? ipc.rememberVaultKey() : ipc.forgetVaultKey(),
                  e.target.checked ? 'The vault will open by itself on this computer.' : 'The key is no longer kept; the passphrase is needed again.')} />
              {t('vaultSettings.openByItselfOn')}
            </label>
            {inProject && (
              <button type="button" className="cv-btn cv-btn-small" data-action="add-credential" onClick={() => setAdding((a) => !a)}>
                {adding ? 'Cancel' : 'Add credential'}
              </button>
            )}
          </div>
          {!inProject && <p className="cv-help" data-region="logins-live-in-projects">{t('vaultSettings.inProjects')}</p>}

          {inProject && adding && (
            <div className="cv-discover-form cv-vault-add">
              <label className="cv-field cv-field-narrow">
                <span>{t('vaultSettings.name')}</span>
                <input className="cv-input" value={label} placeholder={t('vaultSettings.coreSwitches')}
                  onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="cv-field cv-field-narrow">
                <span>{t('vaultSettings.for')}</span>
                <select className="cv-input" value={kind}
                  onChange={(e) => setKind(e.target.value as 'ssh' | 'snmp' | 'meraki' | 'api')}>
                  <option value="ssh">{t('vaultSettings.ssh')}</option>
                  <option value="snmp">{t('vaultSettings.snmp')}</option>
                  {/* A Dashboard API key is a secret like any other,
                      so it is sealed by the same vault rather than getting a
                      store of its own. */}
                  <option value="meraki">{t('vaultSettings.merakiApiKey')}</option>
                  {/* A device's or an FMC's REST login — a username and
                      password, or a token alone with the username blank. */}
                  <option value="api">{t('vaultSettings.apiLogin')}</option>
                </select>
              </label>
              {kind !== 'meraki' && (
                <label className="cv-field cv-field-narrow">
                  <span>{kind === 'snmp' ? 'v3 user (blank for v2c)' : kind === 'api' ? t('vaultSettings.apiUser') : 'Username'}</span>
                  <input className="cv-input" value={username} autoComplete="off"
                    onChange={(e) => setUsername(e.target.value)} />
                </label>
              )}
              <label className="cv-field cv-field-narrow">
                <span>{kind === 'snmp' ? 'Community or auth password' : kind === 'meraki' ? 'API key' : kind === 'api' ? t('vaultSettings.apiSecret') : 'Password'}</span>
                <input className="cv-input" type="password" value={secret} autoComplete="off"
                  onChange={(e) => setSecret(e.target.value)} />
              </label>
              {kind === 'api' && (
                <label className="cv-field cv-field-narrow">
                  <span>{t('vaultSettings.apiPort')}</span>
                  <input className="cv-input" inputMode="numeric" value={apiPort} placeholder="443" autoComplete="off"
                    data-field="api-port" onChange={(e) => setApiPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))} />
                </label>
              )}
              {kind !== 'meraki' && kind !== 'api' && (
                <label className="cv-field cv-field-narrow">
                  <span>{kind === 'snmp' ? 'Privacy password' : 'Enable password'}</span>
                  <input className="cv-input" type="password" value={secondSecret} autoComplete="off"
                    onChange={(e) => setSecondSecret(e.target.value)} />
                </label>
              )}
              <button type="button" className="cv-btn cv-btn-start" onClick={save}
                disabled={!label.trim() || !secret || (kind === 'api' && apiPort !== '' && (Number(apiPort) < 1 || Number(apiPort) > 65535))}>
                Save
              </button>
            </div>
          )}

          {inProject && credentials.length > 0 && (
            <table className="cv-table cv-vault-table">
              <thead>
                <tr>
                  <th>{t('vaultSettings.name')}</th>
                  <th>{t('vaultSettings.for')}</th>
                  <th>{t('vaultSettings.user')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td>{c.kind.toUpperCase()}</td>
                    <td className="cv-mono">{c.username || '—'}</td>
                    <td>
                      <button type="button" className="cv-btn cv-btn-small"
                        onClick={() => act(ipc.deleteCredential(c.id).then(() => useStore.getState().bumpVault()), 'Deleted.')}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {inProject && credentials.length > 0 && (
        <details className="cv-credential-use" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !usage) loadUsage(''); }}>
          <summary>{t('vaultSettings.whereTheyWereUsed')}</summary>
          <p className="cv-help">
            {t('vaultSettings.everyTimeASaved')}
          </p>
          <div className="cv-discover-actions">
            <label className="cv-field cv-field-narrow">
              <span>{t('vaultSettings.credential')}</span>
              <select className="cv-input" value={usageFor} onChange={(e) => loadUsage(e.target.value)}>
                <option value="">{t('vaultSettings.all')}</option>
                {credentials.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <button type="button" className="cv-btn cv-btn-small" disabled={!usage?.length}
              onClick={() => act(ipc.clearCredentialUse().then(() => setUsage([])), 'The use log is cleared.')}>
              {t('vaultSettings.clearTheLog')}
            </button>
          </div>
          {usage && usage.length === 0 && <p className="cv-help">{t('vaultSettings.nothingYet')}</p>}
          {usage && usage.length > 0 && (
            <table className="cv-table cv-vault-table">
              <thead>
                <tr><th>{t('vaultSettings.credential')}</th><th>{t('vaultSettings.for')}</th><th>{t('vaultSettings.device')}</th><th>{t('vaultSettings.lastUsed')}</th><th>{t('vaultSettings.times')}</th></tr>
              </thead>
              <tbody>
                {usage.map((u, i) => (
                  <tr key={`${u.credentialId}-${u.lastMs}-${i}`}>
                    <td>{credentials.find((c) => c.id === u.credentialId)?.label ?? (u.label ? `${u.label} (deleted)` : 'Deleted credential')}</td>
                    <td>{u.purpose}</td>
                    <td className="cv-mono">{u.target}</td>
                    <td className="cv-mono">{dtg(u.lastMs)}</td>
                    <td>{u.uses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}

      {!inProject && (status.unownedCredentials ?? 0) > 0 && (
        <div className="cv-hostkey-actions" data-region="unowned-logins">
          <span className="cv-help">{t('vaultSettings.unowned', { count: status.unownedCredentials ?? 0 })}</span>
          <button type="button" className="cv-btn cv-btn-small cv-btn-danger" data-action="delete-unowned"
            onClick={() => act(ipc.deleteUnownedCredentials(), t('vaultSettings.unownedGone'))}>
            {t('vaultSettings.deleteUnowned')}
          </button>
        </div>
      )}

      {!inProject && status.exists && (
        <div className="cv-hostkey-actions">
          {confirmDiscard ? (
            <>
              <span className="cv-help">
                Discard the vault and all {t('plural.credential', { count: status.allCredentials ?? status.credentials })} — every project's? Without the passphrase they cannot be read,
                so there is nothing to keep. This cannot be undone.
              </span>
              <button type="button" className="cv-btn cv-btn-small" onClick={() => setConfirmDiscard(false)}>
                {t('vaultSettings.keepThem')}
              </button>
              <button type="button" className="cv-btn cv-btn-small cv-btn-danger"
                onClick={() => { setConfirmDiscard(false); act(ipc.discardVault(), 'Vault discarded.'); }}>
                {t('vaultSettings.discardEverything')}
              </button>
            </>
          ) : (
            <button type="button" className="cv-btn cv-btn-small"
              onClick={() => { setMessage(null); setConfirmDiscard(true); }}>
              {t('vaultSettings.forgotThePassphraseStart')}
            </button>
          )}
        </div>
      )}

      {problem && <p className="cv-discover-problem cv-hostkey-message">{problem}</p>}
      {message && !problem && <p className="cv-help cv-hostkey-message">{message}</p>}
    </section>
  );
}
