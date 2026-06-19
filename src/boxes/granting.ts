import type { Function } from "../lib/lambda.js";
import type { Bucket } from "../generated/s3.js";
import type { Table } from "../generated/dynamodb.js";
import type { Queue } from "../generated/sqs.js";
import type { Policy } from "../generated/iam.js";
import { grantRead, grantWrite, grantReadWrite } from "./iam.js";
import { grantTableRead, grantTableReadWrite } from "./dynamodb.js";
import { grantSendMessage, triggerFromQueue } from "./sqs.js";
import type { EventSourceMapping } from "../generated/lambda.js";

type GrantChain = {
  fn: Function;
  policies: Policy[];
  mappings: EventSourceMapping[];
};

type GrantBuilder = {
  read(bucket: Bucket): GrantBuilder;
  write(bucket: Bucket): GrantBuilder;
  readWrite(bucket: Bucket): GrantBuilder;
  tableRead(table: Table): GrantBuilder;
  tableReadWrite(table: Table): GrantBuilder;
  sendMessage(queue: Queue): GrantBuilder;
  triggerFromQueue(queue: Queue, batchSize?: number): GrantBuilder;
  done(): GrantChain;
};

export function granting(fn: Function): GrantBuilder {
  const policies: Policy[] = [];
  const mappings: EventSourceMapping[] = [];
  let current = fn;

  const builder: GrantBuilder = {
    read(bucket: Bucket) {
      const [fn2, , policy] = grantRead(current, bucket);
      current = fn2;
      policies.push(policy);
      return builder;
    },
    write(bucket: Bucket) {
      const [fn2, , policy] = grantWrite(current, bucket);
      current = fn2;
      policies.push(policy);
      return builder;
    },
    readWrite(bucket: Bucket) {
      const [fn2, , policy] = grantReadWrite(current, bucket);
      current = fn2;
      policies.push(policy);
      return builder;
    },
    tableRead(table: Table) {
      const [fn2, , policy] = grantTableRead(current, table);
      current = fn2;
      policies.push(policy);
      return builder;
    },
    tableReadWrite(table: Table) {
      const [fn2, , policy] = grantTableReadWrite(current, table);
      current = fn2;
      policies.push(policy);
      return builder;
    },
    sendMessage(queue: Queue) {
      const [fn2, , policy] = grantSendMessage(current, queue);
      current = fn2;
      policies.push(policy);
      return builder;
    },
    triggerFromQueue(queue: Queue, batchSize?: number) {
      const [fn2, , mapping, policy] = triggerFromQueue(current, queue, batchSize);
      current = fn2;
      mappings.push(mapping);
      policies.push(policy);
      return builder;
    },
    done() {
      return { fn: current, policies, mappings };
    },
  };

  return builder;
}
