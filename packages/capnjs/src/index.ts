import * as acorn from "acorn";
import { RpcStub, type RpcCompatible } from "capnweb";
import invariant from "tiny-invariant";

export const interpret = (code: string, globalThis: RpcStub<{}>) => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
  return ast;
};

type Value = string | boolean | number | null | RegExp | bigint;

class Scope {
  constructor(public vars: Map<string, Value>, public parent: Scope | null) {}

  get(name: string): Value | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }

  set(name: string, value: Value) {
    this.vars.set(name, value);
  }
}

function parseInvariant(
  condition: boolean,
  message: string,
  node: acorn.Node,
): asserts condition {
  if (!condition) {
    throw new Error(`Invariant failed: ${message} at ${node.start}`);
  }
}

function evalInvariant(
  condition: boolean,
  message: string,
  node: acorn.Node,
  value: unknown,
): asserts condition {
  if (!condition) {
    throw new Error(
      `Invariant failed: ${message} at ${
        node.start
      } with value ${JSON.stringify(value)}`,
    );
  }
}

const isSafeMember = (member: string) => {
  const unsafe =
    member in Object.prototype ||
    member === "constructor" ||
    member === "prototype" ||
    member === "__proto__";
  return !unsafe;
};

const assertSafeMember = (member: string, node: acorn.Node): void => {
  evalInvariant(
    isSafeMember(member),
    `Unsafe member access: ${member}`,
    node,
    member,
  );
};

const evalPropertyKey = (
  node: acorn.Expression,
  computed: boolean,
  scope: Scope,
) => {
  let prop: string;
  if (computed) {
    const rawProp = evaluate(node, scope);
    const type = typeof rawProp;
    evalInvariant(
      type === "string" || type === "number",
      `Computed property must evaluate to a string or number`,
      node,
      rawProp,
    );
    prop = rawProp;
  } else {
    parseInvariant(
      node.type === "Identifier",
      "Property must be an identifier",
      node,
    );
    prop = node.name;
  }
  assertSafeMember(prop, node);
  return prop;
};

const evalMemberExpression = (node: acorn.MemberExpression, scope: Scope) => {
  parseInvariant(node.object.type !== "Super", "`super` is not allowed", node);
  parseInvariant(
    node.property.type !== "PrivateIdentifier",
    "Private identifiers are not allowed",
    node,
  );

  const object = evaluate(node.object, scope);
  evalInvariant(
    typeof object === "object" && object !== null,
    `Object must evaluate to an object`,
    node,
    object,
  );

  const prop = evalPropertyKey(node.property, node.computed, scope);
  return { object, prop };
};

const evalArray = (
  args: (acorn.Expression | acorn.SpreadElement | null)[],
  scope: Scope,
) => {
  const result: Value[] = [];
  for (const arg of args) {
    if (arg === null) {
      continue;
    }
    if (arg.type === "SpreadElement") {
      const res = evaluate(arg.argument, scope);
      evalInvariant(
        Array.isArray(res),
        "Spread syntax requires ... iterable to be an array",
        arg.argument,
        res,
      );
      result.push(...res);
    } else {
      result.push(evaluate(arg, scope));
    }
  }
  return result;
};

const isPlainObject = (obj: unknown): obj is Record<string, unknown> => {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(obj);
  return proto === null || proto === Object.prototype;
};

const evaluate = (node: acorn.Expression, scope: Scope) => {
  switch (node.type) {
    case "Identifier":
      return scope.get(node.name);

    case "Literal":
      return node.value;

    case "MemberExpression":
      const { object, prop } = evalMemberExpression(node, scope);
      return object[prop];

    case "CallExpression":
      parseInvariant(
        node.callee.type !== "Super",
        "`super` is not allowed",
        node,
      );
      if (node.callee.type === "MemberExpression") {
        const { object, prop } = evalMemberExpression(node.callee, scope);
        const args = evalArray(node.arguments, scope);
        return object[prop](...args);
      }
      const callee = evaluate(node.callee, scope);
      const args = evalArray(node.arguments, scope);
      return callee(...args);

    case "ArrayExpression":
      return evalArray(node.elements, scope);

    case "ObjectExpression":
      let result = {};
      for (const property of node.properties) {
        if (property.type === "SpreadElement") {
          const res = evaluate(property.argument, scope);
          evalInvariant(
            isPlainObject(res) || Array.isArray(res),
            "Spread syntax requires ... iterable to be a plain object or array",
            property.argument,
            res,
          );
          for (const [key, value] of Object.entries(res)) {
            result[key] = value;
          }
        } else {
          parseInvariant(
            property.kind === "init",
            "Disallowed property kind",
            property,
          );
          parseInvariant(
            !property.shorthand,
            "Shorthand properties are not allowed",
            property,
          );
          parseInvariant(
            !property.method,
            "Property methods not allowed (use function expressions instead)",
            property,
          );

          const key = evalPropertyKey(property.key, property.computed, scope);
          result[key] = evaluate(property.value, scope);
        }
      }
      return result;

    case "ArrowFunctionExpression":
      const params = evalArray(node.params, scope);
  }
};
