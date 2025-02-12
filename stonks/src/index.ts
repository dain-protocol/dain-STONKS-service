import { z } from "zod";
import { restClient } from "@polygon.io/client-js";

import {
  defineDAINService,
  ToolConfig,
  ServiceConfig,
  ToolboxConfig,
  ServiceContext,
  ServicePinnable,
} from "@dainprotocol/service-sdk";

import {
  CardUIBuilder,
  DataGridUIBuilder,
  ChartUIBuilder,
  TableUIBuilder,
  AlertUIBuilder,
} from '@dainprotocol/utils';

const getStockPriceConfig: ToolConfig = {
  id: "get-stock-price",
  name: "Get Stock Price",
  description:
    "Fetches current stock price, daily stats, and 24h price history for a ticker symbol",
  input: z
    .object({
      ticker: z.string().describe("Stock ticker symbol (e.g. AAPL)"),
    })
    .describe("Input parameters for the stock price request"),
  output: z
    .any()
    .describe("Current stock price information"),
  pricing: { pricePerUse: 0, currency: "USD" },
  handler: async ({ ticker }, agentInfo) => {
    console.log(`User / Agent ${agentInfo.id} requested price for ${ticker}`);

    const client = restClient(process.env.POLYGON_API_KEY);
    
    // Get last 5 trading days of data
    const now = new Date();
    const to = now.toISOString().split('T')[0];  // Use today as end date
    
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 7); // Go back 7 days to ensure we get 5 trading days
    const from = fiveDaysAgo.toISOString().split('T')[0];
    
    console.log(`Fetching daily data from ${from} to ${to} for ${ticker}`);
    
    const aggs = await client.stocks.aggregates(
      ticker,
      1,
      'day',
      from,
      to,
      {
        sort: 'desc',
        limit: 10  // Increased limit to make sure we get enough data
      }
    );

    const latestData = aggs.results?.[0];
    if (!latestData) {
      throw new Error(`No data available for ${ticker}`);
    }

    const change = latestData.c - latestData.o;
    const changePercent = ((change) / latestData.o * 100).toFixed(2);

    const chartBuilder = new ChartUIBuilder()
      .type('line')
      .title(`${ticker} 5-Day Price History`)
      .description('Price movement over the last 5 trading days')
      .chartData([...(aggs.results ?? [])].reverse().map(bar => ({
        time: new Date(bar.t).toLocaleDateString(),
        price: bar.c
      })))
      .dataKeys({
        x: 'time',
        y: 'price',
        name: 'Price'
      })
      .trend(parseFloat(changePercent), `${changePercent}% change`);

    const tableBuilder = new TableUIBuilder()
      .addColumns([
        { key: 'metric', header: 'Metric', type: 'text' },
        { key: 'value', header: 'Value', type: 'text' }
      ])
      .rows([
        { metric: 'Volume', value: latestData.v.toLocaleString() },
        { metric: 'Open', value: `$${latestData.o.toFixed(2)}` },
        { metric: 'High', value: `$${latestData.h.toFixed(2)}` },
        { metric: 'Low', value: `$${latestData.l.toFixed(2)}` },
        { metric: 'VWAP', value: `$${latestData.vw.toFixed(2)}` }
      ]);

    const cardBuilder = new CardUIBuilder()
      .title(`${ticker} Stock Price and Stats`)
      .content(`${ticker} is trading at $${latestData.c.toFixed(2)}. Today's change: ${changePercent}%`)
      .addChild(chartBuilder.build())
      .addChild(tableBuilder.build());

    return {
      text: `${ticker} is trading at $${latestData.c.toFixed(2)}. Today's change: ${changePercent}%`,
      data: {
        price: latestData.c,
        high: latestData.h,
        low: latestData.l,
        volume: latestData.v,
        change,
        changePercent: parseFloat(changePercent),
      },
      ui: cardBuilder.build()
    };
  },
};

const getStockNewsConfig: ToolConfig = {
  id: "get-stock-news",
  name: "Get Stock News",
  description: "Fetches latest news articles for a ticker symbol",
  input: z
    .object({
      ticker: z.string().describe("Stock ticker symbol (e.g. AAPL)"),
      limit: z
        .number()
        .optional()
        .describe("Number of news items to fetch (default 5)"),
    })
    .describe("Input parameters for the news request"),
  output: z
    .any()
    .describe("Latest stock news articles"),
  pricing: { pricePerUse: 0, currency: "USD" },
  handler: async ({ ticker, limit = 5 }, agentInfo) => {
    console.log(`User / Agent ${agentInfo.id} requested news for ${ticker}`);

    const client = restClient(process.env.POLYGON_API_KEY);
    const response = await client.reference.tickerNews({ ticker, limit });

    const articles = response.results.map((article) => ({
      title: article.title,
      publisher: article.publisher.name,
      timestamp: article.published_utc,
      url: article.article_url,
    }));

    const tableBuilder = new TableUIBuilder()
      .addColumns([
        { key: 'publisher', header: 'Source', type: 'text' },
        { key: 'title', header: 'Title', type: 'text' },
        { key: 'url', header: 'Link', type: 'link' },
        { key: 'timestamp', header: 'Published', type: 'text' }
      ])
      .rows(articles.map(article => ({
        ...article,
        url: {
          text: 'Read More',
          url: article.url
        },
        timestamp: new Date(article.timestamp).toLocaleDateString()
      })));

    return {
      text: `Found ${articles.length} news articles for ${ticker}`,
      data: { articles },
      ui: tableBuilder.build()
    };
  },
};

const getStockChartConfig: ToolConfig = {
  id: "get-stock-chart", 
  name: "View Stock Chart",
  description: "View historical price chart for a ticker symbol",
  input: z
    .object({
      ticker: z.string().describe("Stock ticker symbol (e.g. AAPL)"),
      multiplier: z.number().describe("Time multiplier"),
      timespan: z.enum([
        "minute",
        "hour",
        "day",
        "week",
        "month",
        "quarter",
        "year",
      ]),
      from: z.string().describe("From date (YYYY-MM-DD)"),
      to: z.string().describe("To date (YYYY-MM-DD)"),
    })
    .describe("Input parameters for chart data request"),
  output: z
    .any()
    .describe("Historical price data"),
  pricing: { pricePerUse: 0, currency: "USD" },
  handler: async ({ ticker, multiplier, timespan, from, to }, agentInfo) => {
    console.log(
      `User / Agent ${agentInfo.id} requested chart for ${ticker}`
    );

    const client = restClient(process.env.POLYGON_API_KEY);
    const response = await client.stocks.aggregates(
      ticker,
      multiplier,
      timespan,
      from,
      to
    );

    const chartBuilder = new ChartUIBuilder()
      .type('line')
      .title(`${ticker} Price History`)
      .description(`From ${from} to ${to}`)
      .chartData(response.results.map(result => ({
        date: new Date(result.t).toLocaleDateString(),
        price: result.c
      })))
      .dataKeys({
        x: 'date',
        y: 'price',
        name: 'Price'
      })
      .footer(`${timespan}ly price data with multiplier ${multiplier}`);

    return {
      text: `Retrieved historical data for ${ticker} from ${from} to ${to}`,
      data: {
        results: response.results,
      },
      ui: chartBuilder.build()
    };
  },
};


const getStockTickerDetailsConfig: ToolConfig = {
  id: "get-stock-details",
  name: "Get Stock Details", 
  description: "Fetches detailed information about a stock ticker including name, market cap, exchange",
  input: z
    .object({
      ticker: z.string().describe("Stock ticker symbol (e.g. AAPL)"),
    })
    .describe("Input parameters for the ticker details request"),
  output: z
    .any()
    .describe("Detailed ticker information"),
  pricing: { pricePerUse: 0, currency: "USD" },
  handler: async ({ ticker }, agentInfo) => {
    console.log(`User / Agent ${agentInfo.id} requested details for ${ticker}`);

    const client = restClient(process.env.POLYGON_API_KEY);
    const response = await client.reference.tickerDetails(ticker);
    const details = response.results;

    const tableBuilder = new TableUIBuilder()
      .addColumns([
        { key: 'field', header: 'Field', type: 'text' },
        { key: 'value', header: 'Value', type: 'text' }
      ])
      .rows([
        { field: 'Name', value: details.name },
        { field: 'Description', value: details.description },
        { field: 'Market Cap', value: details.market_cap?.toLocaleString() },
        { field: 'Exchange', value: details.primary_exchange },
        { field: 'Industry', value: details.sic_description },
        { field: 'Homepage', value: details.homepage_url }
      ]);

    return {
      text: `${ticker} (${details.name}) is listed on ${details.primary_exchange}`,
      data: details,
      ui: tableBuilder.build()
    };
  }
};

const getStockDividendsConfig: ToolConfig = {
  id: "get-stock-dividends",
  name: "Get Stock Dividends",
  description: "Fetches dividend history for a ticker symbol",
  input: z
    .object({
      ticker: z.string().describe("Stock ticker symbol (e.g. AAPL)"),
      limit: z.number().optional().describe("Number of dividend records to fetch (default 10)")
    })
    .describe("Input parameters for the dividends request"),
  output: z
    .any()
    .describe("Dividend history information"),
  pricing: { pricePerUse: 0, currency: "USD" },
  handler: async ({ ticker, limit = 10 }, agentInfo) => {
    console.log(`User / Agent ${agentInfo.id} requested dividends for ${ticker}`);

    const client = restClient(process.env.POLYGON_API_KEY);
    const response = await client.reference.dividends({ ticker, limit });

    const tableBuilder = new TableUIBuilder()
      .addColumns([
        { key: "date", header: "Ex-Dividend Date", type: "text" },
        { key: "amount", header: "Amount", type: "text" },
        { key: "payDate", header: "Pay Date", type: "text" }
      ])
      .rows(response.results.map(div => ({
        date: new Date(div.ex_dividend_date).toLocaleDateString(),
        amount: `$${div.cash_amount.toFixed(2)}`,
        payDate: new Date(div.pay_date).toLocaleDateString()
      })));

    return {
      text: `Retrieved last ${response.results.length} dividend records for ${ticker}`,
      data: response.results,
      ui: tableBuilder.build()
    };
  }
};

const getStockSplitsConfig: ToolConfig = {
  id: "get-stock-splits",
  name: "Get Stock Splits",
  description: "Fetches stock split history for a ticker symbol",
  input: z
    .object({
      ticker: z.string().describe("Stock ticker symbol (e.g. AAPL)"),
      limit: z.number().optional().describe("Number of split records to fetch (default 5)")
    })
    .describe("Input parameters for the splits request"),
  output: z
    .any()
    .describe("Stock split history information"),
  pricing: { pricePerUse: 0, currency: "USD" },
  handler: async ({ ticker, limit = 5 }, agentInfo) => {
    console.log(`User / Agent ${agentInfo.id} requested splits for ${ticker}`);

    const client = restClient(process.env.POLYGON_API_KEY);
    const response = await client.reference.stockSplits({ ticker, limit });

    const tableBuilder = new TableUIBuilder()
      .addColumns([
        { key: "date", header: "Execution Date", type: "text" },
        { key: "ratio", header: "Split Ratio", type: "text" }
      ])
      .rows(response.results.map(split => ({
        date: new Date(split.execution_date).toLocaleDateString(),
        ratio: `${split.split_to}:${split.split_from}`
      })));

    return {
      text: `Retrieved last ${response.results.length} stock splits for ${ticker}`,
      data: response.results,
      ui: tableBuilder.build()
    };
  }
};

const getMarketOverviewWidget: ServicePinnable = {
  id: "marketOverview",
  name: "Market Overview",
  description: "Shows current status of major market indices",
  type: "widget",
  label: "Markets",
  icon: "chart-line",
  getWidget: async () => {
    const client = restClient(process.env.POLYGON_API_KEY);
    
    // Using ETFs that track major indices - these work with basic plan
    const indices = [
      { ticker: "DIA", name: "Dow Jones" },
      { ticker: "SPY", name: "S&P 500" },
      { ticker: "QQQ", name: "NASDAQ" },
      { ticker: "IWM", name: "Russell 2000" }
    ];

    try {
      const results = await Promise.all(
        indices.map(async ({ ticker, name }) => {
          const prevClose = await client.stocks.previousClose(ticker);
          const data = prevClose.results?.[0];
          
          if (!data) {
            return {
              name,
              price: "N/A",
              change: "0.00",
              changePercent: "0.00",
              isPositive: true
            };
          }

          const change = data.c ? data.c - data.o : 0;
          const changePercent = ((change) / (data.o ?? 1) * 100).toFixed(2);
          
          return {
            name,
            price: data.c?.toFixed(2) ?? "N/A",
            change: change.toFixed(2),
            changePercent,
            isPositive: change >= 0
          };
        })
      );

      const tableBuilder = new TableUIBuilder()
        .addColumns([
          { key: 'name', header: 'Index', type: 'text' },
          { key: 'price', header: 'Price', type: 'text' },
          { key: 'change', header: 'Change', type: 'text' },
          { key: 'changePercent', header: '%', type: 'text' }
        ])
        .rows(results.map(result => ({
          name: result.name,
          price: result.price === "N/A" ? "N/A" : `$${Number(result.price).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}`,
          change: `${result.isPositive ? '+' : ''}$${Number(result.change).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}`,
          changePercent: `${result.isPositive ? '+' : ''}${Number(result.changePercent).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}%`
        })));

      const chartBuilder = new ChartUIBuilder()
        .type('line')
        .title('S&P 500')
        .description('30-day price history')
        .chartData(results
          .filter(result => result.price !== "N/A")
          .map(result => ({
            time: result.name,
            price: Number(result.price)
          })))
        .dataKeys({
          x: 'time',
          y: 'price',
          name: 'S&P 500 Price'
        });

      const cardBuilder = new CardUIBuilder()
        .addChild(tableBuilder.build())
        .addChild(chartBuilder.build());

      return {
        text: `Market Overview - S&P 500: ${results[1].changePercent}%`,
        data: results,
        ui: cardBuilder.build()
      };
    } catch (error) {
      console.error("Error fetching market overview:", error);
      return {
        text: "Failed to load market overview",
        data: null,
        ui: new AlertUIBuilder()
          .withVariant('error')
          .withMessage('Unable to load market data at this time. Please check your Polygon.io API key and permissions.')
          .build()
      };
    }
  }
};

const dainService = defineDAINService({
  metadata: {
    title: "Stock Prices and Data Service",
    description:
      "A DAIN service providing real-time stock prices, news, historical data, stock splits, dividends, and detailed company information",
    version: "1.0.0",
    author: "Ryan Trattner",
    logo: "https://compote.slate.com/images/926e5009-c10a-48fe-b90e-fa0760f82fcd.png?crop=680%2C453%2Cx0%2Cy0",
    tags: ["stocks", "finance", "market-data", "polygon"],
  },
  identity: {
    apiKey: process.env.DAIN_API_KEY,
  },

  tools: [getStockPriceConfig, getStockNewsConfig, getStockChartConfig, getStockTickerDetailsConfig, getStockDividendsConfig, getStockSplitsConfig],
  pinnables: [getMarketOverviewWidget],
  exampleQueries: [
    {
      category: "Market Overview",
      queries: [
        "What is the current status of the S&P 500?",
        "How has the NASDAQ performed over the last 30 days?",
        "What are the key drivers of the Dow Jones today?",
        "Show me the Russell 2000's performance over the last month."
      ]
    },
    {
      category: "Stock Price",
      queries: [
        "What is the current price of Tesla (TSLA)?",
        "How has Apple's stock (AAPL) performed over the last week?",
        "What is the latest news on Amazon (AMZN)?",
        "Show me the 52-week high and low for Tesla (TSLA)."
      ]
    },
    {
      category: "Stock Data",
      queries: [
        "What are the dividends for Tesla (TSLA) over the last year?",
        "Show me the stock splits for Apple (AAPL) over the last 5 years.",
        "What is the latest earnings report for Amazon (AMZN)?",
        "How has the market cap of Tesla (TSLA) changed over the last 3 years?"
      ]
    }
  ]
});

dainService.startNode({ port: Number(process.env.PORT) || 2022 }).then(() => {
  console.log("Stock Prices and Data Service is running on port 2022");
});
