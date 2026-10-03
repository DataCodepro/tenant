# TenantConnect - Tenant-to-Landlord Communication and Maintenance Request System (Abuja)

Stack: React 18 (esbuild) + Node.js/Express + MySQL 8, JWT + bcryptjs.

## 1. Set up
```bash
# MySQL: create the database and an app user, then load the schema
mysql -uroot -e "CREATE USER 'tl_app'@'localhost' IDENTIFIED BY 'tl_pass_123'; GRANT ALL ON tenant_landlord.* TO 'tl_app'@'localhost';"
mysql -uroot < schema.sql
cd server && npm install && cd ../client && npm install && npm run build
```
Environment variables (optional): DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, PORT.
Change JWT_SECRET and the DB password before any real deployment.

## 2. Run
```bash
cd server && node seed.js      # optional: demo data (all demo accounts use password Demo1234)
NODE_ENV=test node index.js    # open http://localhost:3000
```
Demo logins: landlord@demo.ng, amina@demo.ng (tenant), musa@demo.ng (plumber).
NODE_ENV=test only makes the password-reset code appear in the API response so it can be tested; leave it unset in production.

## 3. Reproduce the test results (Tables 4.3 - 4.6)
```bash
NODE_ENV=test node server/index.js &
node tests/api_tests.js        # 24 API tests -> tests/results/api_results.json
cd server && node seed.js && cd ..
node tests/browser_tests.js    # screenshots -> docs/screenshots, low-bandwidth test -> tests/results/browser_results.json
```
Browser tests need Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`); adjust the require path at the top of tests/browser_tests.js.

## 4. Analyse your real user-evaluation data (Tables 4.7 - 4.10, 4.12)
Collect answers in CSV files (see tools/sample_data - sample format only, invented numbers) and run:
```bash
python3 tools/analyze_results.py your_data_folder
```
tools/metrics.sql gives the system-side indicators for Table 4.12 from the live database.
