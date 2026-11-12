# Playwright's own image has the browsers and system libraries. Version must match @playwright/test.
FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /e2e
RUN npm init -y >/dev/null && npm install --no-audit --no-fund @playwright/test@1.65.0
COPY e2e-web/playwright.config.ts e2e-web/flow.spec.ts ./
CMD ["npx", "playwright", "test", "-c", "playwright.config.ts"]
