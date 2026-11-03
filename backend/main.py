import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import DateTime, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./portfolio.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
TTL_MINUTES = max(1, int(os.getenv("CACHE_TTL_MINUTES", "15")))
GITHUB_API = "https://api.github.com"


class Base(DeclarativeBase):
    pass


class CachedPortfolio(Base):
    __tablename__ = "portfolios"

    username: Mapped[str] = mapped_column(String(39), primary_key=True)
    profile_json: Mapped[str] = mapped_column(Text)
    repositories_json: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


Base.metadata.create_all(engine)

app = FastAPI(title="Devfolio API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LANGUAGE_KEYWORDS = {
    "JavaScript": ("javascript", "js", "node.js", "nodejs"),
    "TypeScript": ("typescript", "ts"),
    "Python": ("python", "py"),
    "Java": ("java",),
    "C#": ("c#", "csharp", ".net", "dotnet"),
    "C++": ("c++", "cpp"),
    "C": (" c ", " c,", " c.", " c/", " c\n"),
    "Go": ("golang", " go ", " go,", " go."),
    "Rust": ("rust",),
    "PHP": ("php",),
    "Ruby": ("ruby",),
    "Swift": ("swift",),
    "Kotlin": ("kotlin",),
    "Dart": ("dart",),
    "HTML": ("html",),
    "CSS": ("css",),
    "SQL": ("sql", "postgresql", "mysql", "sqlite"),
    "Shell": ("bash", "shell scripting", "shell script"),
}


def github_client() -> httpx.Client:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(headers=headers, timeout=15.0)


def github_get(client: httpx.Client, path: str, params: dict[str, Any] | None = None) -> Any:
    try:
        response = client.get(f"{GITHUB_API}{path}", params=params)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"GitHub could not be reached: {error}") from error
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="GitHub user or resource not found.")
    if response.status_code == 403:
        raise HTTPException(
            status_code=429,
            detail="GitHub API rate limit reached. Configure GITHUB_TOKEN or try again later.",
        )
    if response.is_error:
        raise HTTPException(status_code=502, detail=f"GitHub API returned {response.status_code}.")
    return response.json()


def get_portfolio(username: str, refresh: bool = False) -> dict[str, Any]:
    normalized = username.strip()
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", normalized):
        raise HTTPException(status_code=422, detail="Enter a valid GitHub username.")

    now = datetime.now(timezone.utc)
    with Session(engine) as db:
        cached = db.get(CachedPortfolio, normalized.lower())
        if cached and not refresh:
            expires_at = cached.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at > now:
                import json

                return portfolio_response(
                    json.loads(cached.profile_json),
                    json.loads(cached.repositories_json),
                    True,
                    cached.fetched_at.isoformat(),
                    expires_at.isoformat(),
                )

    with github_client() as client:
        profile = github_get(client, f"/users/{normalized}")
        repositories: list[dict[str, Any]] = []
        page = 1
        while page <= 10:
            batch = github_get(
                client,
                f"/users/{normalized}/repos",
                {"per_page": 100, "page": page, "sort": "updated"},
            )
            if not batch:
                break
            repositories.extend(
                {
                    "id": repo["id"],
                    "name": repo["name"],
                    "full_name": repo["full_name"],
                    "description": repo.get("description"),
                    "html_url": repo["html_url"],
                    "stargazers_count": repo["stargazers_count"],
                    "forks_count": repo["forks_count"],
                    "language": repo.get("language"),
                    "updated_at": repo["updated_at"],
                    "fork": repo["fork"],
                }
                for repo in batch
            )
            if len(batch) < 100:
                break
            page += 1

    public_repositories = [repo for repo in repositories if not repo["fork"]]
    profile_data = {
        "login": profile["login"],
        "name": profile.get("name"),
        "avatar_url": profile["avatar_url"],
        "html_url": profile["html_url"],
        "bio": profile.get("bio"),
        "location": profile.get("location"),
        "company": profile.get("company"),
        "blog": profile.get("blog"),
        "followers": profile["followers"],
        "following": profile["following"],
        "public_repos": profile["public_repos"],
        "created_at": profile["created_at"],
        "total_stars": sum(repo["stargazers_count"] for repo in repositories),
        "total_forks": sum(repo["forks_count"] for repo in repositories),
    }
    timestamp = datetime.now(timezone.utc)
    import json

    with Session(engine) as db:
        cached = db.get(CachedPortfolio, normalized.lower())
        if cached is None:
            cached = CachedPortfolio(
                username=normalized.lower(),
                profile_json="{}",
                repositories_json="[]",
                fetched_at=timestamp,
                expires_at=timestamp,
            )
            db.add(cached)
        cached.profile_json = json.dumps(profile_data)
        cached.repositories_json = json.dumps(public_repositories)
        cached.fetched_at = timestamp
        cached.expires_at = timestamp + timedelta(minutes=TTL_MINUTES)
        db.commit()
    return portfolio_response(
        profile_data,
        public_repositories,
        False,
        timestamp.isoformat(),
        (timestamp + timedelta(minutes=TTL_MINUTES)).isoformat(),
    )


def portfolio_response(
    profile: dict[str, Any],
    repositories: list[dict[str, Any]],
    cached: bool,
    fetched_at: str,
    expires_at: str,
) -> dict[str, Any]:
    language_counts: dict[str, int] = {}
    for repo in repositories:
        if repo["language"]:
            language_counts[repo["language"]] = language_counts.get(repo["language"], 0) + 1
    language_total = sum(language_counts.values())
    return {
        "profile": profile,
        "repositories": repositories,
        "language_stats": [
            {"name": name, "repositories": count, "percentage": round(count / language_total * 100, 1)}
            for name, count in sorted(language_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        "cached": cached,
        "fetched_at": fetched_at,
        "expires_at": expires_at,
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/users/{username}")
def user_portfolio(username: str, refresh: bool = Query(default=False)) -> dict[str, Any]:
    return get_portfolio(username, refresh)


@app.get("/api/users/{username}/contributions")
def contributions(username: str) -> dict[str, Any]:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        return {
            "available": False,
            "reason": "Set GITHUB_TOKEN on the backend to load private contribution history.",
            "days": [],
        }
    query = """
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays { date contributionCount color }
            }
          }
        }
      }
    }
    """
    try:
        response = httpx.post(
            "https://api.github.com/graphql",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query, "variables": {"login": username}},
            timeout=15.0,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"GitHub could not be reached: {error}") from error
    if response.is_error:
        raise HTTPException(status_code=502, detail=f"GitHub GraphQL returned {response.status_code}.")
    payload = response.json()
    if payload.get("errors"):
        raise HTTPException(status_code=502, detail=payload["errors"][0].get("message", "GraphQL request failed."))
    user = payload.get("data", {}).get("user")
    if not user:
        raise HTTPException(status_code=404, detail="GitHub user not found.")
    days = [
        day
        for week in user["contributionsCollection"]["contributionCalendar"]["weeks"]
        for day in week["contributionDays"]
    ]
    return {"available": True, "days": days}


class CompatibilityRequest(BaseModel):
    username: str
    job_description: str = ""
    refresh: bool = False


def extract_languages(text: str) -> list[str]:
    lowered = f" {text.lower()} "
    found = []
    for language, keywords in LANGUAGE_KEYWORDS.items():
        if language == "C":
            matches = re.search(r"(?<![a-z0-9])c(?![a-z0-9+#])", lowered) is not None
        else:
            matches = any(
                re.search(r"(?<![a-z0-9])" + re.escape(keyword.strip()) + r"(?![a-z0-9])", lowered)
                is not None
                for keyword in keywords
            )
        if matches:
            found.append(language)
    return found


@app.post("/api/compatibility")
def compatibility(request: CompatibilityRequest) -> dict[str, Any]:
    portfolio = get_portfolio(request.username, request.refresh)
    required = extract_languages(request.job_description)
    available = {repo["language"] for repo in portfolio["repositories"] if repo["language"]}
    matched = [language for language in required if language in available]
    missing = [language for language in required if language not in available]
    return {
        "required_languages": required,
        "matched_languages": matched,
        "missing_languages": missing,
        "percentage": round(len(matched) / len(required) * 100) if required else 0,
        "has_requirements": bool(required),
        "profile_languages": sorted(available),
    }


class ChatRequest(BaseModel):
    username: str
    question: str


@app.post("/api/assistant")
def assistant(request: ChatRequest) -> dict[str, str]:
    portfolio = get_portfolio(request.username)
    profile = portfolio["profile"]
    repositories = portfolio["repositories"]
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Ask a question to start chatting.")
    context = {
        "profile": profile,
        "repositories": [
            {key: repo[key] for key in ("name", "description", "language", "stargazers_count", "forks_count", "html_url")}
            for repo in repositories[:30]
        ],
    }
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            response = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                    "messages": [
                        {
                            "role": "system",
                            "content": "Answer using only this GitHub portfolio context; say when information is unavailable. Context: "
                            + str(context),
                        },
                        {"role": "user", "content": question},
                    ],
                    "temperature": 0.4,
                },
                timeout=25.0,
            )
            response.raise_for_status()
            return {"answer": response.json()["choices"][0]["message"]["content"], "source": "llm"}
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail=f"Configured AI provider failed: {error}") from error

    lowered = question.lower()
    if any(term in lowered for term in ("language", "stack", "technology")):
        languages = sorted({repo["language"] for repo in repositories if repo["language"]})
        answer = f"Your public repositories use {', '.join(languages)}." if languages else "No primary languages are reported for these public repositories."
    elif any(term in lowered for term in ("star", "popular", "best", "project", "repo")):
        top = sorted(repositories, key=lambda repo: repo["stargazers_count"], reverse=True)[:3]
        answer = (
            "Your most-starred public projects are "
            + ", ".join(f"{repo['name']} ({repo['stargazers_count']} stars)" for repo in top)
            + "."
            if top
            else "There are no public repositories to summarize yet."
        )
    elif any(term in lowered for term in ("fork",)):
        answer = f"Your public repositories have {profile['total_forks']} forks in total."
    else:
        answer = (
            f"{profile.get('name') or profile['login']} has {len(repositories)} public non-fork repositories, "
            f"{profile['total_stars']} stars and {profile['total_forks']} forks. Ask me about projects, languages or stars."
        )
    return {"answer": answer, "source": "portfolio"}


@app.post("/api/career-advice")
def career_advice(request: CompatibilityRequest) -> dict[str, Any]:
    result = compatibility(request)
    missing = result["missing_languages"]
    if not result["has_requirements"]:
        advice = "Add a job description mentioning the required technologies to get tailored recommendations."
        projects = []
    else:
        advice = (
            f"Prioritize demonstrating {', '.join(missing)} in a portfolio project and make the README explain "
            "the problem, architecture, tests and deployment."
            if missing
            else "Your listed repository languages cover every detected requirement. Strengthen your applications with measurable project outcomes."
        )
        projects = [
            f"Build and deploy a production-ready {language} application with tests, a clear README and a live demo."
            for language in missing[:3]
        ]
    return {**result, "advice": advice, "project_ideas": projects}
