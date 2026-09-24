 "use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseSSE } from "../lib/sse";

type Role = "user" | "assistant";
type Message = { id: string; role: Role; content: string; error?: boolean; createdAt: number };
type Chat = { id: string; title: string; messages: Message[]; updatedAt: number; model: string; pinned?: boolean; archived?: boolean; projectId?: string };
type ModelTier = "auto" | "light" | "medium" | "heavy";
type Memory = { id: string; text: string; category: string; createdAt: number };
type Project = { id: string; name: string; description: string; color: string };
type Tab = "chat" | "memory" | "projects" | "files" | "settings";

const MODEL_TIERS: { id: ModelTier; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "KoreAI picks based on the prompt" },
  { id: "light", label: "Light", hint: "Fast everyday questions" },
  { id: "medium", label: "Medium", hint: "Coding and normal reasoning" },
  { id: "heavy", label: "Heavy", hint: "Deep reasoning and large tasks" },
];
const STORE = {
  chats: "koreai.chats.v2",
  memories: "koreai.memories.v2",
  projects: "koreai.projects.v2",
  active: "koreai.active.v2",
};

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => Date.now();

function defaultChat(): Chat {
  return { id: uid(), title: "New conversation", messages: [], updatedAt: now(), model: "auto" };
}

function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? clean.slice(0, 42) + "…" : clean || "New conversation";
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || "code"}</span>
        <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function MessageBody({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n([\s\S]*?)```/g);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      parts[i].split(/\n\n+/).forEach((p, j) => {
        if (p.trim()) out.push(<p key={`${i}-${j}`}>{p}</p>);
      });
    } else if (i % 3 === 1) {
      out.push(<span key={`${i}-lang`} className="sr-only">{parts[i]}</span>);
    } else {
      out.push(<CodeBlock key={`${i}-code`} code={parts[i]} lang={parts[i - 2]} />);
    }
  }
  return <div className="message-body">{out}</div>;
}

export default function Page() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [composerMode, setComposerMode] = useState<"chat" | "build" | "review">("chat");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [toast, setToast] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const savedChats = JSON.parse(localStorage.getItem(STORE.chats) || "[]");
      const savedMemories = JSON.parse(localStorage.getItem(STORE.memories) || "[]");
      const savedProjects = JSON.parse(localStorage.getItem(STORE.projects) || "[]");
      const savedActive = localStorage.getItem(STORE.active) || "";
      const initial = Array.isArray(savedChats) && savedChats.length ? savedChats : [defaultChat()];
      setChats(initial);
      setMemories(Array.isArray(savedMemories) ? savedMemories : []);
      setProjects(Array.isArray(savedProjects) ? savedProjects : []);
      setActiveId(initial.some((c: Chat) => c.id === savedActive) ? savedActive : initial[0].id);
    } catch {
      const c = defaultChat();
      setChats([c]); setActiveId(c.id);
    }
  }, []);

  useEffect(() => { if (chats.length) localStorage.setItem(STORE.chats, JSON.stringify(chats)); }, [chats]);
  useEffect(() => { localStorage.setItem(STORE.memories, JSON.stringify(memories)); }, [memories]);
  useEffect(() => { localStorage.setItem(STORE.projects, JSON.stringify(projects)); }, [projects]);
  useEffect(() => { if (activeId) localStorage.setItem(STORE.active, activeId); }, [activeId]);

  const active = chats.find(c => c.id === activeId) || chats[0];
  const filteredChats = useMemo(() => chats.filter(c => !c.archived && `${c.title} ${c.messages.map(m => m.content).join(" ")}`.toLowerCase().includes(search.toLowerCase())), [chats, search]);
  const relevantMemory = useMemo(() => memories.slice(0, 4), [memories]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 1800);
  }

  function newChat() {
    const c = defaultChat();
    setChats(prev => [c, ...prev]);
    setActiveId(c.id);
    setTab("chat");
    setInput("");
  }

  function updateActive(fn: (chat: Chat) => Chat) {
    if (!active) return;
    setChats(prev => prev.map(c => c.id === active.id ? fn(c) : c));
  }

  function addMemory(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setMemories(prev => [{ id: uid(), text: clean, category: "Preference", createdAt: now() }, ...prev]);
    setMemoryDraft("");
    notify("Memory saved");
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !active) return;

    const userMessage: Message = { id: uid(), role: "user", content: text, createdAt: now() };
    const history = active.messages.filter(m => !m.error && m.content);
    const updated = [...history, userMessage];
    const assistantId = uid();
    updateActive(c => ({
      ...c,
      title: c.title === "New conversation" ? titleFrom(text) : c.title,
      updatedAt: now(),
      messages: [...updated, { id: assistantId, role: "assistant", content: "", createdAt: now() }],
    }));
    setInput("");
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const systemContext = [
      "You are KoreAI, a capable AI coding and workspace assistant.",
      "Be concise but useful. Prefer complete working code when asked.",
      composerMode === "build" ? "The user wants an implementation/build workflow. Think in files and concrete changes." : "",
      composerMode === "review" ? "The user wants a code review. Identify bugs, security issues, performance issues and maintainability concerns." : "",
      relevantMemory.length ? `Relevant user memories: ${relevantMemory.map(m => m.text).join(" | ")}` : "",
    ].filter(Boolean).join("\n");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: active.model, messages: [{ role: "system", content: systemContext }, ...updated.map(({ role, content }) => ({ role, content }))] }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let message = `Request failed (HTTP ${res.status})`;
        try { const data = await res.json(); if (data?.error) message = String(data.error); } catch {}
        throw new Error(message);
      }
      if (!res.body) throw new Error("The server returned no response stream.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      const consume = (final: boolean) => {
        const parsed = parseSSE(final ? buffer + "\n" : buffer);
        buffer = parsed.rest;
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.tokens.length) {
          fullText += parsed.tokens.join("");
          updateActive(c => ({ ...c, updatedAt: now(), messages: c.messages.map(m => m.id === assistantId ? { ...m, content: fullText } : m) }));
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consume(false);
      }
      buffer += decoder.decode();
      consume(true);
      if (!fullText) updateActive(c => ({ ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, content: "The model returned an empty response. Try again.", error: true } : m) }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      updateActive(c => ({ ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, content: message, error: true } : m) }));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function exportChat() {
    if (!active) return;
    const text = active.messages.map(m => `## ${m.role === "user" ? "You" : "KoreAI"}\n\n${m.content}`).join("\n\n");
    const blob = new Blob([`# ${active.title}\n\n${text}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${active.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`; a.click();
    URL.revokeObjectURL(url);
    notify("Chat exported");
  }

  function renameActive() {
    if (!active) return;
    const name = window.prompt("Rename conversation", active.title);
    if (name?.trim()) updateActive(c => ({ ...c, title: name.trim() }));
  }

  function deleteChat(id: string) {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id);
      if (!next.length) {
        const c = defaultChat(); setActiveId(c.id); return [c];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
    notify("Conversation deleted");
  }

  function createProject() {
    const name = projectDraft.trim();
    if (!name) return;
    setProjects(prev => [...prev, { id: uid(), name, description: "AI workspace", color: "steel" }]);
    setProjectDraft("");
    notify("Project created");
  }

  const nav = [
    ["chat", "Chats"], ["projects", "Projects"], ["memory", "Memory"], ["files", "Files"], ["settings", "Settings"]
  ] as const;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="brand-row">
          <button className="icon-btn mobile-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">☰</button>
          <div className="brand-mark">K</div>
          {sidebarOpen && <div><strong>KoreAI</strong><span className="brand-sub">AI workspace</span></div>}
        </div>

        {sidebarOpen && <button className="new-chat" onClick={newChat}><span>＋</span> New chat <kbd>Ctrl ⇧ O</kbd></button>}

        <nav className="nav">
          {nav.map(([id, label]) => (
            <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              <span className="nav-icon">{id === "chat" ? "◫" : id === "projects" ? "▦" : id === "memory" ? "◇" : id === "files" ? "□" : "⚙"}</span>
              {sidebarOpen && <span>{label}</span>}
              {sidebarOpen && id === "memory" && memories.length > 0 && <em>{memories.length}</em>}
            </button>
          ))}
        </nav>

        {sidebarOpen && tab === "chat" && (
          <div className="chat-list-wrap">
            <div className="side-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats" /></div>
            <div className="section-label">Recent</div>
            <div className="chat-list">
              {filteredChats.map(c => (
                <div key={c.id} className={`chat-row ${c.id === activeId ? "selected" : ""}`}>
                  <button onClick={() => { setActiveId(c.id); setTab("chat"); }} className="chat-open">
                    <span className="chat-dot">{c.pinned ? "●" : "○"}</span><span className="chat-title">{c.title}</span>
                  </button>
                  <button className="row-more" onClick={() => { if (window.confirm(`Delete "${c.title}"?`)) deleteChat(c.id); }}>•••</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-bottom">
          {sidebarOpen && <div className="provider-mini"><span className="status-dot"/> API connected <span>⌄</span></div>}
          <button className="profile"><span className="avatar">F</span>{sidebarOpen && <span><strong>Workspace</strong><small>Local session</small></span>}</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumbs">
            <button className="icon-btn desktop-toggle" onClick={() => setSidebarOpen(v => !v)}>☰</button>
            <span className="crumb-muted">Workspace</span><span>/</span><strong>{tab === "chat" ? active?.title || "New conversation" : tab[0].toUpperCase() + tab.slice(1)}</strong>
          </div>
          <div className="top-actions">
            {tab === "chat" && <select className="model-select" title="Select model tier" value={active?.model || "auto"} onChange={e => updateActive(c => ({ ...c, model: e.target.value }))}>{MODEL_TIERS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select>}
            <button className="icon-btn" onClick={() => setInspectorOpen(v => !v)} title="Toggle context panel">▤</button>
            <button className="icon-btn" onClick={() => setTab("settings")} title="Settings">⚙</button>
          </div>
        </header>

        {tab === "chat" && active && (
          <div className="chat-layout">
            <div className="conversation">
              <div ref={chatRef} className="messages">
                {active.messages.length === 0 ? (
                  <div className="welcome">
                    <div className="welcome-k">K</div>
                    <h2>What are you building?</h2>
                    <p>Code, research, debug, review, or turn an idea into a working project.</p>
                    <div className="starter-grid">
                      {[
                        ["Build", "Build a full-stack dashboard from this idea…"],
                        ["Debug", "Help me debug this code and explain the root cause…"],
                        ["Review", "Review my code for bugs, security and performance…"],
                        ["Explain", "Explain this project like I’m joining the team…"],
                      ].map(([label, prompt]) => <button key={label} onClick={() => { setComposerMode(label === "Build" ? "build" : label === "Review" ? "review" : "chat"); setInput(prompt); }}><strong>{label}</strong><span>{prompt}</span><i>↗</i></button>)}
                    </div>
                  </div>
                ) : active.messages.map((m, i) => (
                  <article key={m.id} className={`message ${m.role} ${m.error ? "error" : ""}`}>
                    <div className="message-avatar">{m.role === "user" ? "F" : "K"}</div>
                    <div className="message-main">
                      <div className="message-meta"><strong>{m.role === "user" ? "You" : "KoreAI"}</strong><span>{formatTime(m.createdAt)}</span>{m.role === "assistant" && !m.error && <span className="msg-actions">⌘ Copy · ↻ Regenerate · ⋯</span>}</div>
                      {m.role === "assistant" ? <MessageBody text={m.content || (loading && i === active.messages.length - 1 ? "Thinking…" : "")} /> : <div className="message-body"><p>{m.content}</p></div>}
                    </div>
                  </article>
                ))}
              </div>

              <div className="composer-area">
                <div className="composer-shell">
                  <div className="composer-tools">
                    <button className={composerMode === "chat" ? "tool-active" : ""} onClick={() => setComposerMode("chat")}>Chat</button>
                    <button className={composerMode === "build" ? "tool-active" : ""} onClick={() => setComposerMode("build")}>Build</button>
                    <button className={composerMode === "review" ? "tool-active" : ""} onClick={() => setComposerMode("review")}>Review</button>
                    <span className="composer-spacer"/>
                    <button onClick={() => notify("File picker ready — connect your storage layer to persist uploads.")}>＋ Attach</button>
                  </div>
                  <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={composerMode === "build" ? "Describe the app or change you want to build…" : composerMode === "review" ? "Paste code or describe what you want reviewed…" : "Message KoreAI…"} />
                  <div className="composer-bottom">
                    <div className="composer-hints"><span>⌘K Search</span><span>Shift + Enter newline</span></div>
                    {loading ? <button className="send stop" onClick={() => abortRef.current?.abort()}>■ Stop</button> : <button className="send" disabled={!input.trim()} onClick={sendMessage}>↑</button>}
                  </div>
                </div>
                <div className="composer-disclaimer">KoreAI can make mistakes. Review generated code before running it.</div>
              </div>
            </div>

            {inspectorOpen && (
              <aside className="inspector">
                <div className="inspector-head"><strong>Context</strong><button className="icon-btn" onClick={() => setInspectorOpen(false)}>×</button></div>
                <div className="context-card"><span>Model</span><strong>{MODEL_TIERS.find(m => m.id === active.model)?.label || "Auto"}</strong><small>{MODEL_TIERS.find(m => m.id === active.model)?.hint || "Automatic routing"}</small></div>
                <div className="context-row"><span>Messages</span><strong>{active.messages.length}</strong></div>
                <div className="context-row"><span>Memories</span><strong>{relevantMemory.length}</strong></div>
                <div className="context-row"><span>Files</span><strong>0</strong></div>
                <div className="context-section"><div className="section-label">Relevant memory</div>{relevantMemory.length ? relevantMemory.map(m => <div className="memory-mini" key={m.id}>{m.text}</div>) : <p className="muted">No saved memories yet.</p>}</div>
                <div className="context-section"><div className="section-label">Conversation</div><button className="wide-btn" onClick={renameActive}>Rename chat</button><button className="wide-btn" onClick={exportChat}>Export Markdown</button><button className="wide-btn danger" onClick={() => { updateActive(c => ({ ...c, archived: true })); newChat(); }}>Archive</button></div>
              </aside>
            )}
          </div>
        )}

        {tab === "memory" && (
          <div className="page-panel"><div className="panel-heading"><div><span className="eyebrow">Persistent context</span><h2>Memory</h2><p>Keep useful preferences and project context available across conversations.</p></div></div>
            <div className="add-row"><input value={memoryDraft} onChange={e => setMemoryDraft(e.target.value)} placeholder="e.g. Prefer complete working code and minimal setup steps" /><button onClick={() => addMemory(memoryDraft)}>Save memory</button></div>
            <div className="memory-grid">{memories.map(m => <div className="memory-card" key={m.id}><div className="card-top"><span className="tag">{m.category}</span><button onClick={() => setMemories(prev => prev.filter(x => x.id !== m.id))}>×</button></div><p>{m.text}</p><small>Saved {new Date(m.createdAt).toLocaleDateString()}</small></div>)}{!memories.length && <div className="empty-card">No memories saved yet. Add preferences that should survive across chats.</div>}</div>
          </div>
        )}

        {tab === "projects" && (
          <div className="page-panel"><div className="panel-heading"><div><span className="eyebrow">Workspace organization</span><h2>Projects</h2><p>Group chats, files and instructions around a single codebase or idea.</p></div></div>
            <div className="add-row"><input value={projectDraft} onChange={e => setProjectDraft(e.target.value)} placeholder="New project name" onKeyDown={e => e.key === "Enter" && createProject()} /><button onClick={createProject}>Create project</button></div>
            <div className="project-grid">{projects.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).map(p => <div className="project-card" key={p.id}><div className="project-icon">▦</div><div><strong>{p.name}</strong><p>{p.description}</p><small>0 files · 0 chats</small></div><button onClick={() => setProjects(prev => prev.filter(x => x.id !== p.id))}>×</button></div>)}{!projects.length && <div className="empty-card">Create a project for a codebase, game, website, or long-running idea.</div>}</div>
          </div>
        )}

        {tab === "files" && <div className="page-panel"><div className="panel-heading"><div><span className="eyebrow">Workspace files</span><h2>Files & artifacts</h2><p>Generated artifacts and uploaded files will appear here.</p></div><button className="primary-btn" onClick={() => notify("Upload flow ready")}>＋ Upload files</button></div><div className="artifact-empty"><div>□</div><strong>No files in this workspace</strong><span>Drop source files here or generate a project in Build mode.</span></div></div>}

        {tab === "settings" && <div className="page-panel settings-page"><div className="panel-heading"><div><span className="eyebrow">Preferences</span><h2>Settings</h2><p>Configure the workspace without changing your project code.</p></div></div>{[["General","Appearance, startup behavior and interface density"],["Models","Providers, model defaults and context limits"],["Memory","Persistence and memory controls"],["Tools","Tool permissions: allow, ask, or block"],["Data","Export, local storage and conversation retention"]].map(([a,b]) => <button className="setting-row" key={a}><span><strong>{a}</strong><small>{b}</small></span><span>›</span></button>)}</div>}
      </section>

      {toast && <div className="toast"><span className="status-dot"/> {toast}</div>}
    </main>
  );
}
