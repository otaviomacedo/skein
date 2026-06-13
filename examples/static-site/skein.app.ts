/**
 * Static Site — deploy a website with CloudFront, ACM, and Route53
 *
 * One call produces: S3 content bucket, S3 log bucket, CloudFront distribution,
 * ACM certificate, OAI, and a Route53 alias record.
 */

import { staticSite } from "../../src/boxes/static-site.js";

const site = staticSite("MySite", {
  domain: "mysite.example.com",
  hostedZone: "example.com",
  indexDocument: "index.html",
  errorDocument: "404.html",
});
