import { z } from "zod";
import { restClient } from "@polygon.io/client-js";

import {
  defineDAINService,
  ToolConfig,
  ServiceConfig,
  ToolboxConfig,
  ServiceContext,
} from "@dainprotocol/service-sdk";

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
    
    // Get previous day's close data
    const prevClose = await client.stocks.previousClose(ticker);
    const prevCloseData = prevClose.results[0];

    // Get 24h aggregates with 30 min intervals
    const to = new Date();
    const from = new Date(to.getTime() - (24 * 60 * 60 * 1000)); // 24h ago
    
    const aggs = await client.stocks.aggregates(
      ticker,
      30,
      'minute',
      from.toISOString().split('T')[0],
      to.toISOString().split('T')[0]
    );

    const change = prevCloseData.c ? prevCloseData.c - prevCloseData.o : 0;
    const changePercent = ((change) / (prevCloseData.o ?? 1) * 100).toFixed(2);

    const chartData = {
      type: "line" as const,
      title: `${ticker} 24 Hour Price History`,
      description: `Price movement over the last 24 hours`,
      data: (aggs.results ?? []).map(bar => ({
        time: new Date(bar.t).toLocaleTimeString(),
        price: bar.c ?? 0
      })),
      config: {
        height: 350,
        colors: ["#3B82F6"],
        margin: {
          left: 12,
          right: 12
        }
      },
      dataKeys: {
        x: "time",
        y: "price"
      },
      trend: {
        value: parseFloat(changePercent),
        text: `${changePercent}% change`
      }
    };

    const tableData = {
      columns: [
        {
          key: "metric",
          header: "Metric",
          type: "text",
          width: "40%"
        },
        {
          key: "value", 
          header: "Value",
          type: "text",
          width: "60%"
        }
      ],
      rows: [
        { metric: "Volume", value: (prevCloseData.v ?? 0).toLocaleString() },
        { metric: "Open", value: `$${prevCloseData.o?.toFixed(2) ?? 0}` },
        { metric: "High", value: `$${prevCloseData.h?.toFixed(2) ?? 0}` },
        { metric: "Low", value: `$${prevCloseData.l?.toFixed(2) ?? 0}` },
        { metric: "VWAP", value: `$${prevCloseData.vw?.toFixed(2) ?? 0}` }
      ]
    };

    return {
      text: `${ticker} is trading at $${prevCloseData.c?.toFixed(2)}. Today's change: ${changePercent}%`,
      data: {
        price: prevCloseData.c ?? 0,
        high: prevCloseData.h ?? 0,
        low: prevCloseData.l ?? 0,
        volume: prevCloseData.v ?? 0,
        change,
        changePercent: parseFloat(changePercent),
      },
      ui: {
        type: "div",
        uiData: JSON.stringify({
          title: `${ticker} Stock Price and Stats`,
          content: `${ticker} is trading at $${prevCloseData.c?.toFixed(2)}. Today's change: ${changePercent}%`
        }),
        children: [{
          type: "chart",
          uiData: JSON.stringify(chartData)
        }, 
        /*
        ugly tbh
        {
          type: "table",
          uiData: JSON.stringify(tableData)
        }
          */

      
      ]
      }
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

    const table = {
      columns: [
        {
          key: "publisher",
          header: "Source",
          type: "text",
          width: "20%"
        },
        {
          key: "title", 
          header: "Title",
          type: "text",
          width: "50%"
        },
        {
          key: "url",
          header: "Link",
          type: "link",
          width: "15%"
        },
        {
          key: "timestamp",
          header: "Published",
          type: "text", 
          width: "15%"
        }
      ],
      rows: articles.map(article => ({
        ...article,
        url: {
          text: "Read More",
          url: article.url
        },
        timestamp: new Date(article.timestamp).toLocaleDateString()
      }))
    };

    return {
      text: `Found ${articles.length} news articles for ${ticker}`,
      data: { articles },
      ui: {
        type: "table",
        uiData: JSON.stringify(table)
      },
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

    const chartData = {
      type: "line" as const,
      title: `${ticker} Price History`,
      description: `From ${from} to ${to}`,
      data: response.results.map(result => ({
        date: new Date(result.t).toLocaleDateString(),
        price: result.c
      })),
      config: {
        height: 350,
        colors: ["#3B82F6"],
        margin: {
          left: 12,
          right: 12
        }
      },
      dataKeys: {
        x: "date",
        y: "price"
      },
      footer: `${timespan}ly price data with multiplier ${multiplier}`
    };

    return {
      text: `Retrieved historical data for ${ticker} from ${from} to ${to}`,
      data: {
        results: response.results,
      },
      ui: {
        type: "chart",
        uiData: JSON.stringify(chartData)
      },
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

    const tableData = {
      columns: [
        { key: "field", header: "Field", type: "text", width: "40%" },
        { key: "value", header: "Value", type: "text", width: "60%" }
      ],
      rows: [
        { field: "Name", value: details.name },
        { field: "Description", value: details.description },
        { field: "Market Cap", value: details.market_cap?.toLocaleString() },
        { field: "Exchange", value: details.primary_exchange },
        { field: "Industry", value: details.sic_description },
        { field: "Homepage", value: details.homepage_url }
      ]
    };

    return {
      text: `${ticker} (${details.name}) is listed on ${details.primary_exchange}`,
      data: details,
      ui: {
        type: "table",
        uiData: JSON.stringify(tableData)
      }
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

    const tableData = {
      columns: [
        { key: "date", header: "Ex-Dividend Date", type: "text", width: "30%" },
        { key: "amount", header: "Amount", type: "text", width: "30%" },
        { key: "payDate", header: "Pay Date", type: "text", width: "40%" }
      ],
      rows: response.results.map(div => ({
        date: new Date(div.ex_dividend_date).toLocaleDateString(),
        amount: `$${div.cash_amount.toFixed(2)}`,
        payDate: new Date(div.pay_date).toLocaleDateString()
      }))
    };

    return {
      text: `Retrieved last ${response.results.length} dividend records for ${ticker}`,
      data: response.results,
      ui: {
        type: "table",
        uiData: JSON.stringify(tableData)
      }
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

    const tableData = {
      columns: [
        { key: "date", header: "Execution Date", type: "text", width: "40%" },
        { key: "ratio", header: "Split Ratio", type: "text", width: "60%" }
      ],
      rows: response.results.map(split => ({
        date: new Date(split.execution_date).toLocaleDateString(),
        ratio: `${split.split_to}:${split.split_from}`
      }))
    };

    return {
      text: `Retrieved last ${response.results.length} stock splits for ${ticker}`,
      data: response.results,
      ui: {
        type: "table",
        uiData: JSON.stringify(tableData)
      }
    };
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
});

dainService.startNode({ port: Number(process.env.PORT) || 2022 }).then(() => {
  console.log("Stock Prices and Data Service is running on port 2022");
});
