import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import {
  ArrowUpRight, Bot, BriefcaseBusiness, Check, ChevronDown, CircleHelp,
  Command, ExternalLink, Github, GitFork, GitPullRequest, LayoutDashboard, LoaderCircle,
  MapPin, Moon, RefreshCw, Search, Send, Sparkles, Star, Sun, Users, X,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import "./style.css";

type Repo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
};
type Profile = {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  location: string | null;
  company: string | null;
  blog: string | null;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string;
  total_stars: number;
  total_forks: number;
};
type LanguageStat = { name: string; repositories: number; percentage: number };
type Portfolio = {
  profile: Profile;
  repositories: Repo[];
  language_stats: LanguageStat[];
  cached: boolean;
  fetched_at: string;
};
type Contribution = { date: string; contributionCount: number };
type Compatibility = {
  percentage: number;
  required_languages: string[];
  matched_languages: string[];
  missing_languages: string[];
  has_requirements: boolean;
  profile_languages: string[];
};
type ChatMessage = { role: "user" | "assistant"; text: string };

const colors = ["#a78bfa", "#63e6be", "#65a9ff", "#ffba69", "#f285a7", "#7cdbd1"];
const DEFAULT_USERNAME = "Kunjshah06";
const api = axios.create({ baseURL: "/api" });
const formatNumber = (value: number) => new Intl.NumberFormat("en", { notation: value > 9999 ? "compact" : "standard" }).format(value);
const relativeDate = (date: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
const errorText = (error: unknown) => axios.isAxiosError(error) ? error.response?.data?.detail || error.message : "Something went wrong.";

function App() {
  const [theme, setTheme] = useState<"dark" | "light">(
    () => localStorage.getItem("devfolio-theme") === "light" ? "light" : "dark",
  );
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [input, setInput] = useState(DEFAULT_USERNAME);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [contributions, setContributions] = useState<Contribution[] | null>(null);
  const [contributionUnavailable, setContributionUnavailable] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [languageFilter, setLanguageFilter] = useState("All languages");
  const [jobDescription, setJobDescription] = useState("");
  const [compatibility, setCompatibility] = useState<Compatibility | null>(null);
  const [careerAdvice, setCareerAdvice] = useState<{ advice: string; project_ideas: string[] } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const profileRequestId = useRef(0);

  const loadPortfolio = async (target: string, refresh = false) => {
    const requestedUsername = target.trim();
    if (!requestedUsername) {
      setError("Enter a GitHub username to search.");
      return;
    }
    const requestId = ++profileRequestId.current;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get<Portfolio>(`/users/${encodeURIComponent(requestedUsername)}`, { params: { refresh } });
      if (requestId !== profileRequestId.current) return;
      setPortfolio(data);
      setUsername(data.profile.login);
      setInput(data.profile.login);
      setCompatibility(null);
      setCareerAdvice(null);
      setMessages([]);
      setContributions(null);
      setContributionUnavailable("");
      try {
        const contributionResponse = await api.get(`/users/${encodeURIComponent(data.profile.login)}/contributions`);
        if (requestId !== profileRequestId.current) return;
        if (contributionResponse.data.available) setContributions(contributionResponse.data.days);
        else setContributionUnavailable(contributionResponse.data.reason);
      } catch {
        if (requestId === profileRequestId.current) {
          setContributionUnavailable("Contribution history could not be loaded.");
        }
      }
    } catch (requestError) {
      if (requestId !== profileRequestId.current) return;
      setError(errorText(requestError));
      setPortfolio(null);
    } finally {
      if (requestId === profileRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("devfolio-theme", theme);
  }, [theme]);

  useEffect(() => { void loadPortfolio(DEFAULT_USERNAME); }, []);

  const filteredRepos = useMemo(() => {
    if (!portfolio) return [];
    return portfolio.repositories.filter((repo) => {
      const matchesSearch = `${repo.name} ${repo.description || ""}`.toLowerCase().includes(repoSearch.toLowerCase());
      const matchesLanguage = languageFilter === "All languages" || repo.language === languageFilter;
      return matchesSearch && matchesLanguage;
    });
  }, [portfolio, repoSearch, languageFilter]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadPortfolio(input);
  };

  const analyzeJob = async () => {
    if (!portfolio) return;
    setAnalyzing(true);
    try {
      const [compat, advice] = await Promise.all([
        api.post<Compatibility>("/compatibility", { username, job_description: jobDescription }),
        api.post<Compatibility & { advice: string; project_ideas: string[] }>("/career-advice", { username, job_description: jobDescription }),
      ]);
      setCompatibility(compat.data);
      setCareerAdvice({ advice: advice.data.advice, project_ideas: advice.data.project_ideas });
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setAnalyzing(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const question = chatInput.trim();
    if (!question || !portfolio || chatLoading) return;
    setMessages((current) => [...current, { role: "user", text: question }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const { data } = await api.post<{ answer: string }>("/assistant", { username, question });
      setMessages((current) => [...current, { role: "assistant", text: data.answer }]);
    } catch (requestError) {
      setMessages((current) => [...current, { role: "assistant", text: errorText(requestError) }]);
    } finally {
      setChatLoading(false);
    }
  };

  const contributionCount = contributions?.reduce((sum, day) => sum + day.contributionCount, 0) ?? 0;
  const contributionMap = new Map((contributions || []).map((day) => [day.date, day.contributionCount]));
  const calendarDays = contributions ? buildCalendar(contributions) : [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Devfolio home">
          <div className="brand-mark"><Command size={19} strokeWidth={2.2} /></div>
          <span>devfolio<span className="brand-dot">.</span></span>
          <span className="brand-tag">BETA</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          <a className="nav-item active" href="#overview"><LayoutDashboard size={17} /> Overview</a>
          <a className="nav-item" href="#repositories"><Github size={17} /> Repositories <span className="nav-count">{portfolio?.repositories.length ?? "—"}</span></a>
          <a className="nav-item" href="#activity"><GitPullRequest size={17} /> Activity</a>
        </nav>
        <div className="workspace-label tools-label">YOUR TOOLKIT</div>
        <nav className="side-nav">
          <a className="nav-item" href="#compatibility"><BriefcaseBusiness size={17} /> Job match</a>
          <a className="nav-item" href="#assistant"><Sparkles size={17} /> Portfolio AI <span className="ai-tag">AI</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="tip-card">
            <div className="tip-icon"><Sparkles size={15} /></div>
            <div className="tip-title">Your next opportunity starts here</div>
            <p>See how your skills line up with your next role.</p>
            <a href="#compatibility">Check your job match <ArrowUpRight size={13} /></a>
          </div>
          <div className="sidebar-user">
            <div className="mini-avatar">{portfolio?.profile.login.slice(0, 1).toUpperCase() ?? "D"}</div>
            <div className="sidebar-user-copy"><strong>{portfolio?.profile.name || username}</strong><span>GitHub profile</span></div>
            <ChevronDown size={15} className="muted-icon" />
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Portfolio overview</strong></div>
          <div className="top-actions">
            <div className="live-status"><span className="live-dot" /> Live data</div>
            <button className="icon-button" title="Refresh profile data" onClick={() => void loadPortfolio(username, true)} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button>
            <button
              className="icon-button"
              type="button"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="top-avatar">{portfolio?.profile.login.slice(0, 1).toUpperCase() ?? "D"}</div>
          </div>
        </header>

        <div className="page-wrap">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> DEVELOPER ANALYTICS</div>
              <h1>Your work, <span>at a glance.</span></h1>
              <p className="welcome-subtitle">A living snapshot of your open-source journey.</p>
            </div>
            <form className="search-form" onSubmit={submitSearch}>
              <Search size={17} />
              <input aria-label="Search GitHub username" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search GitHub username" />
              {input && <button className="clear-search" type="button" onClick={() => setInput("")} aria-label="Clear search"><X size={14} /></button>}
              <button className="search-submit" type="submit" disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : "Search"}</button>
            </form>
          </section>

          {error && <div className="error-banner" role="alert"><CircleHelp size={17} /> <span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
          {loading && portfolio && <div className="loading-banner" role="status" aria-live="polite"><LoaderCircle size={14} className="spin" /> Loading @{input.trim()} from GitHub…</div>}

          {loading && !portfolio ? <LoadingState /> : portfolio ? (
            <>
              <section className="profile-card panel">
                <div className="profile-main">
                  <img className="profile-avatar" src={portfolio.profile.avatar_url} alt={`${portfolio.profile.login} avatar`} />
                  <div className="profile-copy">
                    <div className="profile-name-row"><h2>{portfolio.profile.name || portfolio.profile.login}</h2><a href={portfolio.profile.html_url} target="_blank" rel="noreferrer" className="verified-profile">GITHUB PROFILE <ExternalLink size={11} /></a></div>
                    <div className="profile-login">@{portfolio.profile.login}</div>
                    <p className="profile-bio">{portfolio.profile.bio || "No bio added yet. Let your work speak for itself."}</p>
                    <div className="profile-meta">
                      {portfolio.profile.location && <span><MapPin size={13} />{portfolio.profile.location}</span>}
                      {portfolio.profile.company && <span>{portfolio.profile.company}</span>}
                      {portfolio.profile.blog && <a href={portfolio.profile.blog.startsWith("http") ? portfolio.profile.blog : `https://${portfolio.profile.blog}`} target="_blank" rel="noreferrer">{portfolio.profile.blog.replace(/^https?:\/\//, "")}<ExternalLink size={11} /></a>}
                    </div>
                  </div>
                </div>
                <div className="profile-right">
                  <div className="profile-since">ON GITHUB SINCE</div>
                  <div className="since-date">{new Date(portfolio.profile.created_at).getFullYear()}</div>
                  <div className="cache-state"><span className={portfolio.cached ? "cache-dot cached" : "cache-dot"} />{portfolio.cached ? "Cached snapshot" : "Just refreshed"}</div>
                </div>
              </section>

              <section className="stats-grid" aria-label="GitHub statistics">
                <StatCard label="Public repositories" value={formatNumber(portfolio.profile.public_repos)} detail={`${portfolio.repositories.length} non-fork projects shown`} icon={<Github size={16} />} tone="purple" />
                <StatCard label="Total stars" value={formatNumber(portfolio.profile.total_stars)} detail="Across public repositories" icon={<Star size={16} />} tone="amber" />
                <StatCard label="Total forks" value={formatNumber(portfolio.profile.total_forks)} detail="Community contributions" icon={<GitFork size={16} />} tone="mint" />
                <StatCard label="Followers" value={formatNumber(portfolio.profile.followers)} detail={`${formatNumber(portfolio.profile.following)} following`} icon={<Users size={16} />} tone="blue" />
              </section>

              <div className="section-grid">
                <section className="panel contribution-panel" id="activity">
                  <div className="section-heading">
                    <div><div className="section-kicker">CONSISTENCY, OVER TIME</div><h3>Contribution activity</h3></div>
                    {contributions && <div className="contribution-total"><strong>{formatNumber(contributionCount)}</strong> contributions</div>}
                  </div>
                  {contributions ? (
                    <div className="heatmap-scroll">
                      <div className="heatmap-months">{calendarMonths(calendarDays).map((month) => <span key={`${month.label}-${month.column}`} style={{ gridColumn: `${month.column} / span 4` }}>{month.label}</span>)}</div>
                      <div className="heatmap-layout"><div className="weekday-labels"><span>Mon</span><span>Wed</span><span>Fri</span></div><div className="heatmap-grid">{calendarDays.map((day) => {
                        const count = contributionMap.get(day) ?? 0;
                        return <span key={day} className={`heat-cell level-${intensity(count)}`} title={`${count} contribution${count === 1 ? "" : "s"} on ${day}`} aria-label={`${count} contributions on ${day}`} />;
                      })}</div></div>
                      <div className="heatmap-footer"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <span key={level} className={`heat-cell level-${level}`} />)}<span>More</span><span className="heatmap-note">Last 12 months</span></div>
                    </div>
                  ) : <div className="unavailable-state"><div className="unavailable-icon"><GitPullRequest size={18} /></div><div><strong>Contribution history unavailable</strong><p>{contributionUnavailable || "Checking contribution access…"}</p></div></div>}
                </section>

                <section className="panel languages-panel">
                  <div className="section-heading">
                    <div><div className="section-kicker">WHAT YOU BUILD WITH</div><h3>Top languages</h3></div>
                    <span className="chart-caption">By repositories</span>
                  </div>
                  {portfolio.language_stats.length ? (
                    <div className="language-content">
                      <div className="donut-wrap"><ResponsiveContainer width="100%" height={132} minWidth={1}><PieChart><Pie data={portfolio.language_stats} dataKey="repositories" nameKey="name" innerRadius="55%" outerRadius="78%" paddingAngle={3} stroke="none">{portfolio.language_stats.map((item, index) => <Cell key={item.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip contentStyle={{ background: theme === "dark" ? "#151821" : "#ffffff", border: `1px solid ${theme === "dark" ? "#2a2e3a" : "#d9dce5"}`, borderRadius: 9, color: theme === "dark" ? "#f4f4f5" : "#252839" }} formatter={(value: number, name: string) => [`${value} repos`, name]} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{portfolio.language_stats.length}</strong><span>languages</span></div></div>
                      <div className="language-list">{portfolio.language_stats.slice(0, 5).map((language, index) => <div className="language-item" key={language.name}><span className="language-dot" style={{ backgroundColor: colors[index % colors.length] }} /><span className="language-name">{language.name}</span><span className="language-percent">{language.percentage}%</span></div>)}</div>
                    </div>
                  ) : <div className="empty-languages">No language data in public repositories.</div>}
                  <div className="language-footnote">Share of repositories with a primary language</div>
                </section>
              </div>

              <section className="panel repositories-panel" id="repositories">
                <div className="repo-heading">
                  <div><div className="section-kicker">BUILT IN THE OPEN</div><h3>Repositories <span className="heading-count">{portfolio.repositories.length}</span></h3></div>
                  <div className="repo-filters">
                    <div className="repo-search"><Search size={14} /><input value={repoSearch} onChange={(event) => setRepoSearch(event.target.value)} placeholder="Find a repository..." aria-label="Search repositories" /></div>
                    <div className="language-select-wrap"><select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)} aria-label="Filter by language"><option>All languages</option>{portfolio.language_stats.map((language) => <option key={language.name}>{language.name}</option>)}</select><ChevronDown size={13} /></div>
                  </div>
                </div>
                {filteredRepos.length ? <div className="repo-grid">{filteredRepos.map((repo) => <article className="repo-card" key={repo.id}>
                  <div className="repo-card-top"><div className="repo-symbol"><Github size={16} /></div><a className="repo-external" href={repo.html_url} target="_blank" rel="noreferrer" aria-label={`Open ${repo.name} on GitHub`}><ExternalLink size={14} /></a></div>
                  <a className="repo-name" href={repo.html_url} target="_blank" rel="noreferrer">{repo.name}</a>
                  <p className="repo-description">{repo.description || "No description provided."}</p>
                  <div className="repo-card-footer"><div className="repo-metrics">{repo.language && <span className="repo-language"><i style={{ background: colors[portfolio.language_stats.findIndex((item) => item.name === repo.language) % colors.length] || colors[0] }} />{repo.language}</span>}<span><Star size={13} />{formatNumber(repo.stargazers_count)}</span><span><GitFork size={13} />{formatNumber(repo.forks_count)}</span></div><time title={repo.updated_at}>Updated {relativeDate(repo.updated_at)}</time></div>
                </article>)}</div> : <div className="empty-repos"><Search size={18} /><span>No repositories match those filters.</span><button onClick={() => { setRepoSearch(""); setLanguageFilter("All languages"); }}>Clear filters</button></div>}
              </section>

              <div className="section-grid lower-grid">
                <section className="panel compatibility-panel" id="compatibility">
                  <div className="section-heading">
                    <div><div className="section-kicker">MAKE YOUR NEXT MOVE</div><h3>Tech stack match</h3></div>
                    <div className="feature-icon purple-feature"><BriefcaseBusiness size={17} /></div>
                  </div>
                  <p className="panel-description">Compare your repository languages against a role's requirements.</p>
                  <label className="sr-only" htmlFor="job-description">Job description</label>
                  <textarea id="job-description" className="job-textarea" value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste a job description here…&#10;&#10;We’ll identify the programming languages and compare them with your public repos." />
                  <div className="analyze-row"><span>Language keyword matching</span><button className="primary-button" onClick={() => void analyzeJob()} disabled={analyzing}>{analyzing ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Analyze match</button></div>
                  {compatibility && <div className="compat-result">
                    {!compatibility.has_requirements ? <p className="result-note">No recognized languages found. Try adding a job description with explicit technology requirements.</p> : <>
                      <div className="score-row"><div className="score-ring"><strong>{compatibility.percentage}<small>%</small></strong></div><div><strong className="score-title">{compatibility.percentage >= 70 ? "Strong alignment" : compatibility.percentage >= 40 ? "Good starting point" : "Room to grow"}</strong><span>{compatibility.matched_languages.length} of {compatibility.required_languages.length} required languages found</span></div></div>
                      <div className="skill-tags"><div className="skill-group"><span>YOU HAVE</span><div>{compatibility.matched_languages.length ? compatibility.matched_languages.map((item) => <span className="skill-tag matched" key={item}><Check size={11} />{item}</span>) : <i>None detected</i>}</div></div><div className="skill-group"><span>TO EXPLORE</span><div>{compatibility.missing_languages.length ? compatibility.missing_languages.map((item) => <span className="skill-tag missing" key={item}>{item}</span>) : <i>You're covered</i>}</div></div></div>
                      {careerAdvice && <div className="career-advice"><strong><Sparkles size={14} /> Career advisor</strong><p>{careerAdvice.advice}</p>{careerAdvice.project_ideas.map((idea) => <div className="project-idea" key={idea}><ArrowUpRight size={13} />{idea}</div>)}</div>}
                    </>}
                  </div>}
                </section>

                <section className="panel assistant-panel" id="assistant">
                  <div className="section-heading">
                    <div><div className="section-kicker">YOUR WORK, UNDERSTOOD</div><h3>Portfolio assistant</h3></div>
                    <div className="feature-icon mint-feature"><Bot size={17} /></div>
                  </div>
                  <p className="panel-description">Ask anything about this developer's actual work and stack.</p>
                  <div className="chat-window">
                    {messages.length === 0 ? <div className="chat-empty"><div className="chat-bot-icon"><Bot size={18} /></div><strong>Hey, I know this portfolio.</strong><p>Try asking about projects, languages, or stars.</p><div className="prompt-pills"><button onClick={() => setChatInput("What are the top projects?")}>Top projects</button><button onClick={() => setChatInput("What languages are used?")}>Languages</button></div></div> : <div className="chat-messages">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${index}-${message.role}`}><span className="message-avatar">{message.role === "assistant" ? <Sparkles size={12} /> : username.slice(0, 1).toUpperCase()}</span><p>{message.text}</p></div>)}{chatLoading && <div className="chat-loading"><LoaderCircle size={14} className="spin" /> Thinking…</div>}</div>}
                  </div>
                  <form className="chat-form" onSubmit={(event) => void sendMessage(event)}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about this portfolio..." aria-label="Ask the portfolio assistant" /><button disabled={!chatInput.trim() || chatLoading} title="Send message" aria-label="Send message"><Send size={15} /></button></form>
                  <div className="assistant-footnote"><span className="assistant-spark"><Sparkles size={11} /></span> Grounded in live GitHub data</div>
                </section>
              </div>
              <footer className="page-footer"><span>Built for developers who build in the open.</span><span>{portfolio.cached ? "Cached data" : "Live from GitHub"} <span className="footer-dot">·</span> Updated {relativeDate(portfolio.fetched_at)}</span></footer>
            </>
          ) : !loading && <div className="welcome-empty panel"><div className="empty-github"><Github size={24} /></div><h2>Find your next story.</h2><p>Search a GitHub username to turn open-source work into a portfolio you can act on.</p><form className="empty-search" onSubmit={submitSearch}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Try a GitHub username" aria-label="GitHub username" /><button className="primary-button">Explore profile <ArrowUpRight size={14} /></button></form></div>}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) {
  return <article className="stat-card panel"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div><div className={`stat-trend ${tone}`}>All time</div></article>;
}

function LoadingState() {
  return <div className="loading-dashboard"><div className="skeleton profile-skeleton" /><div className="skeleton-stats">{[1, 2, 3, 4].map((n) => <div className="skeleton" key={n} />)}</div><div className="skeleton-bottom">{[1, 2].map((n) => <div className="skeleton" key={n} />)}</div><div className="loading-caption"><LoaderCircle size={15} className="spin" /> Fetching live profile data…</div></div>;
}

function buildCalendar(days: Contribution[]) {
  return days.map((day) => day.date);
}

function calendarMonths(days: string[]) {
  const seen = new Set<string>();
  const months: { label: string; column: number }[] = [];
  days.forEach((day, index) => {
    const date = new Date(`${day}T00:00:00Z`);
    const label = date.toLocaleString("en", { month: "short", timeZone: "UTC" });
    if (!seen.has(`${date.getUTCFullYear()}-${date.getUTCMonth()}`) && date.getUTCDate() <= 7) {
      seen.add(`${date.getUTCFullYear()}-${date.getUTCMonth()}`);
      months.push({ label, column: Math.floor(index / 7) + 1 });
    }
  });
  return months;
}

function intensity(count: number) {
  if (!count) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  if (count < 10) return 3;
  return 4;
}

createRoot(document.getElementById("root")!).render(<App />);
