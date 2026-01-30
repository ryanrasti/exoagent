import * as acorn from "acorn";
import { RpcStub, type RpcCompatible } from "capnweb";

export const interpret = (code: string, globalThis: RpcStub<{}>) => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
  return ast;
};

type Value = string | boolean | number | null | RegExp | bigint | undefined | Value[];

class Scope {
  constructor(public vars: Map<string, Value>, public parent: Scope | null) {}

  get(name: string): Value | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }

  private set(name: acorn.Identifier, value: Value) {
    evalInvariant(!this.vars.has(name.name), "Variable already bound", name, name.name);
    this.vars.set(name.name, value);
  }

  bind(param: acorn.Pattern, value: Value) {
    switch (param.type) {
      case "Identifier":
        this.set(param, value);
        break;
      case "MemberExpression":
        parseInvariant(false, "Member assignment is not allowed", param);
        break;
      case "AssignmentPattern":
        let rhs: Value = value;
        if (rhs === undefined) {
          rhs = evaluate(param.right, this);
        }
        this.bind(param.left, rhs);
        break;
      case "ArrayPattern":
        // If we relax this to any iterable, just be careful about using a `...` spread:
        evalInvariant(Array.isArray(value), "Array pattern must evaluate to an array", param, value);
        for (const [i, pat] of param.elements.entries()) {
          if (pat === null) {
            continue;
          }
          if (pat.type === 'RestElement') {
            parseInvariant(param.elements.length === i + 1, "Rest element must be last", pat);
            this.bind(pat, value.slice(i));
            break;
          }
          this.bind(pat, value[i]);
        }
        break;
      case "ObjectPattern":
        evalInvariant(Array.isArray(value) || isPlainObject(value), "Object pattern must evaluate to an object or array", param, value);
        
        const bound: Set<string | number> = new Set();
        for (const [i, property] of param.properties.entries()) {
          if (property.type === 'RestElement') {
            parseInvariant(property.argument.type === 'Identifier', "Rest element must be an identifier", property.argument);
            parseInvariant(param.properties.length === i + 1, "Rest element must be last", property.argument);
            const copy = {}
            for (const key of value.keys()) {
              if (bound.has(key)) {
                continue;
              }
              copy[key] = value[key];
            }
            this.set(property.argument, copy);
            break;
          }
          let key;
          if (property.computed) {
            key = evaluate(property.key, this);
          } else {
            parseInvariant(property.key.type === 'Identifier', "Property key must be an identifier", property.key);
            key = property.key.name;
          }
          // it isn't really necessary to check this here since we're saving to a `Map`, but for consistency
          // we'll do it anyway:
          assertSafeMember(key, property.key);
          this.bind(property.value, copy[key as keyof typeof value] as Value);
          bound.add(key);
        }
        break;

      case "RestElement":
        evalInvariant(Array.isArray(value), "Rest element must evaluate to an array", param, value);
        this.bind(param.argument, value);
        break;

      default:
        param satisfies never;
        parseInvariant(false, "Invalid pattern", param);
    }
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

function assertSafeMember(member: unknown, node: acorn.Node): asserts member is string | number {
  const type = typeof member;
  evalInvariant(type === 'string' || type === 'number', "Member must be a string or number", node, member);
  evalInvariant(
    type === 'number' || isSafeMember(member as string),
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
  let prop: unknown;
  if (computed) {
    prop = evaluate(node, scope);
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
      // If we relax this to any iterable, just be careful about the `...` spread:
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
      let result: {[key: string]: Value} = {};
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
      parseInvariant(
        !node.async,
        "Async functions are not allowed",
        node,
      );
      parseInvariant(
        !node.generator,
        "Generator functions are not allowed",
        node,
      );
      parseInvariant(
        node.expression,
        "Arrow functions must be expressions",
        node,
      );
    
      return (...args: Value[]) => {
        const localScope = new Scope(new Map(), scope);
        for (const [i, param] of node.params.entries()) {
          localScope.bind(param, args[i]);
        }
        return evaluate(node.body, localScope);
      };
  }
};
