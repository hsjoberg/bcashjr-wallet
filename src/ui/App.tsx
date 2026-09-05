import { useEffect, useRef, useState } from "react";
import type { WalletSnapshot } from "../core/types.ts";
import { walletApi } from "./bridge.ts";
import { Dashboard } from "./Dashboard.tsx";
import { errorMessage, Spinner } from "./shared.tsx";

interface SetupProps {
  onReady(snapshot: WalletSnapshot, mnemonic: string): void;
}

interface PasswordRevealButtonProps {
  controls: string;
  visible: boolean;
  onToggle(): void;
}

function PasswordRevealButton({ controls, visible, onToggle }: PasswordRevealButtonProps) {
  return (
    <button
      type="button"
      className="password-reveal-button"
      aria-controls={controls}
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      title={visible ? "Hide password" : "Show password"}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.75" />
        {visible && <path d="M4 4l16 16" />}
      </svg>
    </button>
  );
}

function Setup({ onReady }: SetupProps) {
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creationWarningOpen, setCreationWarningOpen] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      passwordInput.current?.focus({ preventScroll: true })
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  function concealPassword() {
    // Change the DOM property immediately as well as React state so there is
    // no visible plaintext frame while an async wallet operation begins.
    if (passwordInput.current) passwordInput.current.type = "password";
    setPasswordVisible(false);
  }

  function selectMode(nextMode: "create" | "restore") {
    concealPassword();
    setMode(nextMode);
  }

  async function finishSetup(selectedMode: "create" | "restore") {
    concealPassword();
    setCreationWarningOpen(false);
    setBusy(true);
    setError("");
    try {
      const result = selectedMode === "create"
        ? await walletApi.createWallet({ password })
        : await walletApi.restoreWallet({ mnemonic, password });
      setPassword("");
      setMnemonic("");
      onReady(result.snapshot, selectedMode === "create" ? result.mnemonic : "");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    concealPassword();
    setError("");
    if (mode === "create") {
      setCreationWarningOpen(true);
      return;
    }
    await finishSetup("restore");
  }

  function closeCreationWarning() {
    setCreationWarningOpen(false);
    requestAnimationFrame(() => passwordInput.current?.focus({ preventScroll: true }));
  }

  function togglePasswordVisibility() {
    setPasswordVisible((visible) => !visible);
    requestAnimationFrame(() => {
      const input = passwordInput.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  return (
    <main className="setup-shell">
      <section className="setup-copy">
        <div className="brand">
          <span>BcashJr Wallet</span>
        </div>
        <p>
          Use this Taproot wallet to manage coins across Bitcoin and the BTC-BLAKE hardfork, replay
          eligible Bitcoin funding transactions on the fork, and split shared coins using{" "}
          <code>SIGHASH_UNIFIED</code> replay protection so each side can be spent separately.
        </p>
      </section>

      <section className="setup-card card">
        <div className="segmented">
          <button
            type="button"
            className={mode === "create" ? "active" : ""}
            onClick={() => selectMode("create")}
          >
            New wallet
          </button>
          <button
            type="button"
            className={mode === "restore" ? "active" : ""}
            onClick={() => selectMode("restore")}
          >
            Restore
          </button>
        </div>
        <h2>{mode === "create" ? "Create a wallet" : "Restore your wallet"}</h2>
        <p className="muted">BIP39 12 words · BIP86 Taproot</p>
        <form onSubmit={submit} autoComplete="off">
          {mode === "restore" && (
            <p className="seed-reuse-warning">
              Existing wallet seeds are supported, but reusing a seed from another wallet is not
              recommended.
            </p>
          )}
          {mode === "restore" && (
            <label>
              Recovery phrase
              <textarea
                rows={4}
                value={mnemonic}
                onChange={(event) => setMnemonic(event.target.value)}
                placeholder="twelve words separated by spaces"
                required
                spellCheck={false}
              />
            </label>
          )}
          <div className="password-field">
            <label htmlFor="setup-password">Local encryption password</label>
            <div className="password-input-wrap">
              <input
                ref={passwordInput}
                id="setup-password"
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Required to unlock this wallet"
                autoComplete="off"
                autoFocus
                required
              />
              <PasswordRevealButton
                controls="setup-password"
                visible={passwordVisible}
                onToggle={togglePasswordVisibility}
              />
            </div>
            <small className="field-help">
              Encrypts this wallet on this computer. This is not a BIP39 seed passphrase.
            </small>
          </div>
          {error && <div className="error-box">{error}</div>}
          <button className="primary wide" disabled={busy} type="submit">
            {busy && <Spinner />}
            {mode === "create" ? "Create wallet" : "Restore wallet"}
          </button>
        </form>
      </section>
      {creationWarningOpen && (
        <div className="modal-backdrop">
          <section
            className="modal funding-warning-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="funding-warning-title"
          >
            <div className="eyebrow">BEFORE YOU FUND</div>
            <h2 id="funding-warning-title">Start with a small test amount</h2>
            <p>
              Do not send a large amount of Bitcoin as your first deposit. Prove the complete wallet
              flow with an amount you can afford to risk before committing meaningful funds.
            </p>
            <ul className="funding-warning-list">
              <li>Double-check the receive address before sending.</li>
              <li>
                Check the current BTC-BLAKE fee rate before choosing your test amount. Its 300 kB
                blocks can make fees higher than on Bitcoin.
              </li>
              <li>Verify the test deposit appears on the expected chain or chains.</li>
              <li>Test splitting and spending, then confirm the resulting transactions.</li>
            </ul>
            <p className="funding-disclaimer">
              This wallet is provided “as is,” without warranties. You use it at your own risk. The
              developers accept no responsibility for lost funds.
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" autoFocus onClick={closeCreationWarning}>
                Go back
              </button>
              <button type="button" className="primary" onClick={() => finishSetup("create")}>
                I understand · Create wallet
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Recovery({ mnemonic, onDone }: { mnemonic: string; onDone(): Promise<void> }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const words = mnemonic.split(" ");

  async function finishRecovery() {
    setBusy(true);
    setError("");
    try {
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        className="modal recovery-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
      >
        <div className="eyebrow">RECOVERY PHRASE</div>
        <h2 id="recovery-title">Write these 12 words down</h2>
        <p className="muted">
          This is the only backup. Anyone with these words can spend the wallet.
        </p>
        <ol className="word-grid">
          {words.map((word, index) => (
            <li key={`${word}-${index}`}>
              <span>{index + 1}</span>
              {word}
            </li>
          ))}
        </ol>
        <label className="check-row">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I saved the recovery phrase offline.</span>
        </label>
        {error && <div className="error-box">{error}</div>}
        <button
          type="button"
          className="primary wide"
          disabled={!acknowledged || busy}
          onClick={() => void finishRecovery()}
        >
          {busy && <Spinner />}Open wallet
        </button>
      </section>
    </div>
  );
}

function Locked(
  { onUnlock }: { onUnlock(snapshot: WalletSnapshot, mnemonic: string): void },
) {
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusPassword = () => passwordInput.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(focusPassword);
    const retry = globalThis.setTimeout(focusPassword, 150);
    globalThis.addEventListener("focus", focusPassword);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(retry);
      globalThis.removeEventListener("focus", focusPassword);
    };
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (passwordInput.current) passwordInput.current.type = "password";
    setPasswordVisible(false);
    setBusy(true);
    setError("");
    try {
      const snapshot = await walletApi.unlock(password);
      const mnemonic = snapshot.recoveryPhraseAcknowledged ? "" : await walletApi.recoveryPhrase();
      onUnlock(snapshot, mnemonic);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function togglePasswordVisibility() {
    setPasswordVisible((visible) => !visible);
    requestAnimationFrame(() => {
      const input = passwordInput.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  return (
    <main className="locked-shell">
      <section className="locked-card card">
        <div className="eyebrow">BcashJr Wallet</div>
        <h1>Wallet locked</h1>
        <form onSubmit={unlock} autoComplete="off">
          <div>
            <label htmlFor="unlock-password">Password</label>
            <div className="password-input-wrap">
              <input
                id="unlock-password"
                ref={passwordInput}
                autoFocus
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                required
              />
              <PasswordRevealButton
                controls="unlock-password"
                visible={passwordVisible}
                onToggle={togglePasswordVisibility}
              />
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
          <button type="submit" className="primary wide" disabled={busy}>
            {busy && <Spinner />}Unlock
          </button>
        </form>
      </section>
    </main>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [mnemonic, setMnemonic] = useState("");
  const [fatal, setFatal] = useState("");

  useEffect(() => {
    let active = true;
    async function openWallet() {
      try {
        const next = await walletApi.snapshot();
        const words = next.lockState === "unlocked" && !next.recoveryPhraseAcknowledged
          ? await walletApi.recoveryPhrase()
          : "";
        if (!active) return;
        setMnemonic(words);
        setSnapshot(next);
      } catch (error) {
        if (active) setFatal(errorMessage(error));
      }
    }
    void openWallet();
    return () => {
      active = false;
    };
  }, []);

  if (fatal) {
    return (
      <main className="locked-shell">
        <div className="card locked-card">
          <h1>Unable to open wallet</h1>
          <div className="error-box">{fatal}</div>
        </div>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="loading-screen">
        <Spinner />
        <span>Opening wallet…</span>
      </main>
    );
  }
  if (snapshot.lockState === "empty") {
    return (
      <Setup
        onReady={(next, words) => {
          setSnapshot(next);
          setMnemonic(words);
        }}
      />
    );
  }
  if (snapshot.lockState === "locked") {
    return (
      <Locked
        onUnlock={(next, words) => {
          setSnapshot(next);
          setMnemonic(words);
        }}
      />
    );
  }
  return (
    <>
      <Dashboard snapshot={snapshot} setSnapshot={setSnapshot} />
      {mnemonic && (
        <Recovery
          mnemonic={mnemonic}
          onDone={async () => {
            const next = await walletApi.acknowledgeRecoveryPhrase();
            setSnapshot(next);
            setMnemonic("");
          }}
        />
      )}
    </>
  );
}
