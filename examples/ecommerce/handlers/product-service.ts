import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createServer } from "node:http";

const db = new DynamoDBClient({});
const TABLE = process.env.INVENTORY_TABLE!;
const PORT = Number(process.env.PORT || 80);

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url === "/products") {
    try {
      const result = await db.send(new ScanCommand({ TableName: TABLE, Limit: 100 }));
      const items = (result.Items || []).map(unmarshall);
      res.writeHead(200);
      res.end(JSON.stringify(items));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Product catalog service listening on port ${PORT}`);
});

