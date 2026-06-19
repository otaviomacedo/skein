import { mkBucket } from "../generated/s3.js";
import type { Bucket } from "../generated/s3.js";
import { mkDistribution, mkCloudFrontOriginAccessIdentity } from "../generated/cloudfront.js";
import type { Distribution, DistributionProps } from "../generated/cloudfront.js";
import { mkCertificate } from "../generated/certificatemanager.js";
import type { Certificate } from "../generated/certificatemanager.js";
import { pipe } from "./pipe.js";
import { encrypt, blockPublicAccess, enableWebHosting, enableLogDelivery } from "./s3.js";
import { setOrigin, enableAccessLogging, attachCert, addAliasRecord } from "./cloudfront.js";
import { box } from "../runtime/box.js";

export interface StaticSiteOptions {
  domain: string;
  hostedZone?: string;
  indexDocument?: string;
  errorDocument?: string;
}

export interface StaticSiteOutput {
  distribution: Distribution;
  contentBucket: Bucket;
  logBucket: Bucket;
  certificate: Certificate;
}

export const staticSite = box(
  "staticSite",
  (prefix: string, options: StaticSiteOptions): StaticSiteOutput => {
    const { domain, hostedZone, indexDocument = "index.html", errorDocument = "error.html" } = options;

    // Content bucket: web hosting, encrypted, public access blocked
    const contentBucket = pipe(
      mkBucket(`${prefix}ContentBucket`, {}),
    )
      .to(enableWebHosting, indexDocument, errorDocument)
      .to(encrypt)
      .to(blockPublicAccess)
      .done();

    // Log bucket: configured for log delivery
    const logBucket = pipe(
      mkBucket(`${prefix}LogBucket`, {}),
    )
      .to(enableLogDelivery)
      .to(encrypt)
      .to(blockPublicAccess)
      .done();

    // CloudFront OAI for secure S3 access
    const oai = mkCloudFrontOriginAccessIdentity(`${prefix}OAI`, {
      cloudFrontOriginAccessIdentityConfig: {
        comment: `OAI for ${domain}`,
      },
    });

    // ACM certificate for the domain
    const certificate = mkCertificate(`${prefix}Cert`, {
      domainName: domain,
      validationMethod: "DNS",
    });

    // CloudFront distribution: origin, logging, certificate, alias
    // defaultCacheBehavior is omitted here as setOrigin provides it
    const dist = mkDistribution(`${prefix}Dist`, {
      distributionConfig: {
        enabled: true,
        defaultRootObject: indexDocument,
        aliases: [domain],
      } as DistributionProps["distributionConfig"],
    });

    let distribution = pipe(dist)
      .to(setOrigin, contentBucket, oai)
      .to(enableAccessLogging, logBucket)
      .to(attachCert, certificate)
      .done();

    // Route53 alias record if hostedZone is provided
    if (hostedZone) {
      [distribution] = addAliasRecord(distribution, { hostedZone, recordName: domain });
    }

    return { distribution, contentBucket, logBucket, certificate };
  },
);
