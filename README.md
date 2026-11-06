# Budgee

Budgee tells you whether you're going to overspend this month while there's still time to do something about it. Live at [budgee1.netlify.app](https://budgee1.netlify.app).

Upload a CSV of your recent transactions and Budgee will:

- **Forecast your month-end total**, with a likely range and the chance you'll go over budget
- **Find your regular bills** (rent, phone, subscriptions) and count the ones still coming
- **Learn your weekly rhythm**, like spending more on weekends, and use it for the days ahead
- **Spot one-off splurges** so a single big purchase doesn't throw off the forecast
- **Tell you what to change**: how much you can safely spend per day, and which categories are running hot
- **Sort purchases into categories** from their descriptions, and let you fix any it gets wrong

Everything runs in your browser. Your file is never uploaded anywhere.

## Using it

1. Download your transactions from your bank's website as a CSV. Two or three months works best.
2. Drop the file into Budgee and enter your monthly budget.
3. Read your forecast.

The file needs a `date` column and an `amount` column. `description` and `category` columns are optional. Most bank exports work as they are, including ones with separate debit and credit columns. There's a template on the site if you'd rather fill one in yourself.

## How the forecast works

`js/engine.js` does all the math:

1. **Reads the file.** Detects the delimiter and columns, handles date formats like `10/14/2026` and `Oct 14, 2026`, amounts like `($12.50)`, and skips transfers and paychecks.
2. **Finds bills.** A merchant that charges a similar amount around the same day in two or more months is treated as a bill. Everyday spots need three months of matching charges.
3. **Learns your pattern.** Builds an average for each day of the week from your history, weighting recent weeks more heavily, and leaves out one-off splurges.
4. **Adjusts for this month.** If you're spending faster or slower than usual, the forecast leans that way, more strongly as the month goes on.
5. **Simulates the rest of the month** 2,000 times by replaying real days from your history. That gives the likely range and the chance of going over budget.

## Running locally

It's a static site with no build step. Serve the folder with any web server, for example `python3 -m http.server`, and open `localhost:8000`.

`npm test` runs the engine tests (Node 18+). `npm run sample` regenerates the sample data.

## Chrome extension

The original extension popup (`popup.html`, `popup.js`, `styles.css`) is still in the repo and works as before.
