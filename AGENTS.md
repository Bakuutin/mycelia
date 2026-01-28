# AGENT GUIDELINES FOR MYCELIA REPOSITORY

This document outlines the essential guidelines for agentic coding agents operating within the Mycelia repository. Adhering to these guidelines ensures consistency, maintainability, and quality across the codebase.

## 1. Build, Lint, and Test Commands

This repository consists of multiple projects with different technologies. Ensure you use the correct commands for the relevant sub-project.

### 1.1. Backend (Deno/TypeScript)

*   **Project Root:** `/backend`
*   **Build/Run:**
    *   `deno run --watch -A server.ts serve` (Development server)
    *   `deno run -A server.ts serve` (Production server)
*   **Linting:**
    *   `deno lint` (Entire project)
    *   To lint a specific file: `deno lint <path_to_file>`
*   **Testing:**
    *   `deno test` (Run all tests)
    *   To run a single test file: `deno test <path_to_test_file>` (e.g., `deno test backend/app/lib/auth/tests/auth.test.ts`)
*   **Additional Linting (via npm):**
    *   `npm run lint` (if available in `backend/package.json` scripts, otherwise it's likely just `deno lint`)

### 1.2. Diarizator (Python)

*   **Project Root:** `/diarizator`
*   **Build/Install Dependencies:**
    *   `pip install -e .` (Editable install, typically in a virtual environment)
    *   `uv pip install -e .` (Using `uv` as indicated by `pyproject.toml`)
*   **Linting/Formatting:**
    *   `black .` (Auto-format Python code)
    *   `isort .` (Auto-sort Python imports)
*   **Testing:**
    *   `pytest` (Run all tests)
    *   To run a single test file: `pytest <path_to_test_file>` (e.g., `pytest diarizator/src/simple_speaker_recognition/api/tests/test_speaker_service.py`)

### 1.3. Frontend (React/TypeScript)

*   **Project Root:** `/frontend`
*   **Access URL:** `https://localhost:4433/` (via nginx proxy in Docker)
*   **Install Dependencies:** Deno handles dependencies automatically
*   **Build/Run:**
    *   `deno task dev` (Development server - typically accessed via Docker at https://localhost:4433/)
    *   `deno task build` (Build for production)
    *   `deno task preview` (Preview production build)
*   **Linting:**
    *   `deno lint` (Run linting)
*   **Testing:**
    *   `deno task test` (Run tests)
    *   To run a single test file: `deno test <path_to_test_file>`

### 1.4. Diarizator Web UI (React/TypeScript)

*   **Project Root:** `/diarizator/webui`
*   **Install Dependencies:** `npm install` or `yarn install`
*   **Build/Run:**
    *   `npm run dev` (Development server)
    *   `npm run build` (Build for production)
    *   `npm run preview` (Preview production build)
*   **Linting:**
    *   `npm run lint` (Runs `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`)
*   **Testing:**
    *   `npm test` or `yarn test` (Assumed, as no explicit script was found, but commonly used for React projects)
    *   To run a single test file: `npm test <path_to_test_file>` (Assumption)

## 2. Code Style Guidelines

These guidelines are derived from existing code and configuration.

### 2.1. General Principles

*   **Consistency:** Always prioritize consistency with existing code within the same file or module.
*   **Readability:** Write clear, concise, and easily understandable code.
*   **Type Safety:** Leverage type systems (TypeScript, Python type hints) to ensure code correctness and maintainability.

### 2.2. TypeScript (Deno Backend, Diarizator Web UI)

*   **Imports:**
    *   Use explicit imports.
    *   Utilize path aliases defined in `deno.json` (e.g., `@/`, `#`).
    *   Deno: `jsr:` and `npm:` specifiers for external modules.
    *   For Web UI: Standard Node.js module resolution.
*   **Formatting:**
    *   Follow the existing formatting style. Deno has a built-in formatter (`deno fmt`), and Prettier is commonly used in Node.js/React projects.
    *   Indentation: 2 spaces (common for TypeScript projects).
    *   Quotes: Prefer single quotes for strings unless double quotes are necessary (e.g., for JSX attributes or strings containing single quotes).
*   **Naming Conventions:**
    *   **Variables/Functions:** `camelCase` (e.g., `myVariable`, `calculateSum`).
    *   **Classes/Interfaces/Types:** `PascalCase` (e.g., `MyClass`, `MyInterface`, `UserType`).
    *   **Constants:** `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRIES`).
    *   **Files:** `kebab-case` (e.g., `my-component.ts`, `utility-functions.ts`).
*   **Typing:**
    *   Use TypeScript types extensively for clarity and to catch errors early.
    *   Define interfaces or types for complex objects.
    *   Avoid `any` unless absolutely necessary and justified. If `any` is used, consider adding a comment explaining why. The `deno.json` excludes `no-explicit-any`, indicating a pragmatic approach.
*   **Error Handling:**
    *   Use `try...catch` blocks for error-prone operations, especially asynchronous ones.
    *   Propagate errors appropriately.
    *   For HTTP APIs, return meaningful error responses with appropriate status codes (e.g., using `HTTPException` in FastAPI or Express/Deno's equivalent).
    *   Log errors with sufficient context using `console.error` (which is custom-handled in the Deno backend).

### 2.3. Python (Diarizator)

*   **Imports:**
    *   Group imports: standard library, third-party, local modules.
    *   `isort` is configured (`profile = "black"`), so ensure imports are sorted automatically.
*   **Formatting:**
    *   Follow `black` formatting standards.
    *   Indentation: 4 spaces.
    *   Line Length: Max 88 characters (Black's default).
    *   Quotes: Prefer double quotes for strings.
*   **Naming Conventions:**
    *   **Variables/Functions:** `snake_case` (e.g., `my_variable`, `calculate_sum`).
    *   **Classes:** `PascalCase` (e.g., `MyClass`).
    *   **Constants:** `SCREAMING_SNAKE_CASE`.
    *   **Files:** `snake_case` (e.g., `my_module.py`).
*   **Typing:**
    *   Use Python type hints for function signatures, class attributes, and variables.
    *   Leverage `typing` module (e.g., `Optional`, `Union`, `List`, `Dict`).
*   **Error Handling:**
    *   Use `try...catch` blocks for handling exceptions.
    *   Raise specific exceptions where appropriate.
    *   For FastAPI endpoints, use `HTTPException` for client or server errors.
    *   Use the standard `logging` module for logging messages.

---

## 3. Cursor Rules and Copilot Instructions

No specific Cursor rules (`.cursor/rules/` or `.cursorrules`) or Copilot instructions (`.github/copilot-instructions.md`) were found in this repository. Agents should follow the general code style guidelines mentioned above.
