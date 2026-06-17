/**
 * Schema extractor: uses the TypeScript compiler API to inspect exported box
 * functions and emit their input schemas automatically.
 *
 * For each exported box, it:
 * 1. Finds the function signature (the inner fn passed to box())
 * 2. For each parameter, determines if it's:
 *    - A string/number literal → { kind: "string" } or { kind: "number" }
 *    - A Resource<"AWS::..."> type → { kind: "resource", type: "AWS::..." }
 *    - An interface/object type → { kind: "props", value: <minimal instance> }
 * 3. Emits a BoxSchema that can be fed to checkCompatAuto
 */

import ts from "typescript";
import { InputKind, BoxSchema } from "./index.js";

export type ExtractedSchema = {
  boxName: string;
  schema: BoxSchema;
};

export function extractSchemas(filePath: string, tsconfigPath?: string): ExtractedSchema[] {
  const configPath = tsconfigPath ?? ts.findConfigFile(filePath, ts.sys.fileExists, "tsconfig.json");
  const configFile = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined;
  const compilerOptions = configFile
    ? ts.parseJsonConfigFileContent(configFile.config, ts.sys, ".").options
    : { strict: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext };

  const program = ts.createProgram([filePath], compilerOptions);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) return [];

  const results: ExtractedSchema[] = [];
  const sourceSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!sourceSymbol) return [];

  const exports = checker.getExportsOfModule(sourceSymbol);

  for (const exp of exports) {
    const type = checker.getTypeOfSymbolAtLocation(exp, sourceFile);
    const callSignatures = type.getCallSignatures();
    if (callSignatures.length === 0) continue;

    const sig = callSignatures[0];
    const params = sig.getParameters();
    if (params.length === 0) continue;

    // box() wraps functions as (...args: TIn) => TOut where TIn is a tuple.
    // Decompose the tuple to get the actual parameter types.
    const paramTypes = resolveParamTypes(params, checker, sourceFile);
    if (paramTypes.length === 0) continue;

    const inputs: InputKind[] = [];
    for (const paramType of paramTypes) {
      inputs.push(typeToInputKind(paramType, checker));
    }

    results.push({ boxName: exp.getName(), schema: { inputs } });
  }

  return results;
}

function resolveParamTypes(
  params: readonly ts.Symbol[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): ts.Type[] {
  if (params.length === 1) {
    // box() produces (...args: TIn) => TOut where TIn is a tuple type.
    // Check if the single param is a rest param with a tuple type.
    const paramType = checker.getTypeOfSymbolAtLocation(params[0], sourceFile);
    if (checker.isTupleType(paramType)) {
      const typeArgs = (paramType as ts.TypeReference).typeArguments;
      if (typeArgs) return [...typeArgs];
    }
  }

  // Fallback: treat each param individually
  return params.map(p => checker.getTypeOfSymbolAtLocation(p, sourceFile));
}

function isStringType(type: ts.Type, checker: ts.TypeChecker): boolean {
  return !!(type.flags & ts.TypeFlags.String) || !!(type.flags & ts.TypeFlags.StringLiteral);
}

function typeToInputKind(type: ts.Type, checker: ts.TypeChecker): InputKind {
  if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
    return { kind: "string", value: "fixture" };
  }

  if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
    return { kind: "number", value: 1 };
  }

  // Check for Resource<"AWS::..."> — look for __type property with a literal type
  const cfnType = extractCfnType(type, checker);
  if (cfnType) {
    return { kind: "resource", type: cfnType };
  }

  // Check for arrays of resources
  if (isArrayType(type, checker)) {
    const elementType = getArrayElementType(type, checker);
    if (elementType) {
      const elemCfnType = extractCfnType(elementType, checker);
      if (elemCfnType) {
        return { kind: "resource", type: elemCfnType };
      }
    }
  }

  // Fall back to generating a minimal object from the interface
  const minimalProps = buildMinimalObject(type, checker);
  return { kind: "props", value: minimalProps };
}

function extractCfnType(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  // Resource types have a __type property with a string literal type
  const typeProperty = type.getProperty("__type");
  if (!typeProperty) return undefined;

  const propType = checker.getTypeOfSymbol(typeProperty);
  if (propType.isStringLiteral()) {
    return propType.value;
  }
  return undefined;
}

function isArrayType(type: ts.Type, checker: ts.TypeChecker): boolean {
  const symbol = type.getSymbol();
  if (symbol && (symbol.getName() === "Array" || symbol.getName() === "ReadonlyArray")) return true;
  if (checker.isArrayType(type)) return true;
  return false;
}

function getArrayElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const typeArgs = (type as ts.TypeReference).typeArguments;
  if (typeArgs && typeArgs.length > 0) return typeArgs[0];
  return undefined;
}

function buildMinimalObject(type: ts.Type, checker: ts.TypeChecker): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = type.getProperties();

  for (const prop of properties) {
    if (prop.flags & ts.SymbolFlags.Optional) continue;

    const propType = checker.getTypeOfSymbol(prop);
    result[prop.getName()] = buildMinimalValue(propType, checker);
  }

  return result;
}

function buildMinimalValue(type: ts.Type, checker: ts.TypeChecker): unknown {
  if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
    return "placeholder";
  }
  if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
    return 1;
  }
  if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
    return true;
  }

  if (isArrayType(type, checker)) {
    return [];
  }

  if (type.flags & ts.TypeFlags.Object) {
    const cfnType = extractCfnType(type, checker);
    if (cfnType) return `__resource:${cfnType}`;
    return buildMinimalObject(type, checker);
  }

  if (type.isUnion()) {
    const first = type.types[0];
    if (first) return buildMinimalValue(first, checker);
  }

  return "placeholder";
}
