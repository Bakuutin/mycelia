import { z } from "zod";
import { minimatch } from "minimatch";
import { type Auth } from "./core.server.ts";
import { permissionDenied } from "./utils.ts";

export type Rule = string & { __brand: "Rule" } | string;
export type Code = string & { __brand: "Code" } | string;
export type ResourcePath = string | string[];

export function matchResourcePath(path: ResourcePath, rule: Rule): boolean {
  if (Array.isArray(path)) {
    path = path.join("/");
  }
  return minimatch(path, rule);
}

export type SimplePolicy = {
  resource: Rule;
  action: Rule;
  effect: "allow" | "deny";
};

export type ModifyPolicy<Arg> = {
  resource: Rule;
  action: Rule;
  effect: "modify";
  middleware: {
    code: Code;
    arg?: Arg;
  };
};

export type Policy = SimplePolicy | ModifyPolicy<any>;

export type MiddlewareFunction<Input, Output, Arg> = (
  opts: { arg: Arg; auth: Auth; input: Input },
  next: (input: Input, auth: Auth) => Promise<Output>,
) => Promise<Output>;

export type ResourceAccessModifier<Input, Output, Arg> = {
  schema?: z.ZodSchema<Arg>;
  use: MiddlewareFunction<Input, Output, Arg>;
};

export interface Resource<Input, Output> {
  code: Code;
  schemas: {
    request: z.ZodSchema<Input>;
    response: z.ZodSchema<Output>;
  };
  modifiers?: {
    [key: string]: ResourceAccessModifier<Input, Output, any>;
  };
  use: (input: Input, auth: Auth) => Promise<Output>;
  extractActions: (input: Input) => {
    path: ResourcePath;
    actions: string[];
  }[];
}

export class ResourceManager {
  resources: Map<string, Resource<any, any>>;

  constructor() {
    this.resources = new Map();
  }

  registerResource(
    resourceClass: Resource<any, any> | (new () => Resource<any, any>),
  ): Resource<any, any> {
    const resourceInstance = typeof resourceClass === "function"
      ? new (resourceClass as new () => Resource<any, any>)()
      : resourceClass;
    const existing = this.resources.get(resourceInstance.code);
    if (existing) {
      return existing;
    }
    this.resources.set(resourceInstance.code, resourceInstance);
    return resourceInstance;
  }

  matchPolicy(policy: Policy, resource: ResourcePath, action: string): boolean {
    return matchResourcePath(resource, policy.resource) &&
      minimatch(action, policy.action);
  }

  async getResource<Input, Output>(
    code: Code,
    auth: Auth,
  ): Promise<(input: Input) => Promise<Output>> {
    const resource: Resource<Input, Output> | undefined = this.resources.get(
      code,
    );

    if (!resource) {
      permissionDenied({
        message: `Resource ${code} not found`,
        availableResources: Array.from(this.resources.keys()),
      });
    }

    return async (input: Input): Promise<Output> => {
      const actions = resource.extractActions(input);

      const flatActions = actions.flatMap((action) =>
        action.actions.map((subAction) => ({
          path: action.path,
          action: subAction,
        }))
      );

      const unmatchedActions = new Set(flatActions);

      const matchedPolicies: Policy[] = [];

      for (const action of flatActions) {
        for (const policy of auth.policies) {
          if (!this.matchPolicy(policy, action.path, action.action)) {
            continue;
          }

          matchedPolicies.push(policy);
          unmatchedActions.delete(action);

          if (policy.effect === "deny") {
            permissionDenied({
              policy,
              actions: [action],
            });
          }
        }
      }

      if (unmatchedActions.size > 0) {
        permissionDenied({
          actions: [...unmatchedActions],
        });
      }

      let finalUse = resource.use.bind(resource);

      for (let i = matchedPolicies.length - 1; i >= 0; i--) {
        const policy = matchedPolicies[i];

        if (policy.effect === "modify") {
          const modifier:
            | ResourceAccessModifier<Input, Output, any>
            | undefined = resource.modifiers?.[policy.middleware.code];

          if (!modifier) {
            permissionDenied();
          }

          const { success, data } = modifier.schema
            ? modifier.schema.safeParse(
              policy.middleware.arg,
            )
            : { success: true, data: null };

          if (!success) {
            permissionDenied();
          }

          const currentUse = finalUse;
          finalUse = async (input: Input) =>
            modifier.use({
              arg: data,
              auth,
              input,
            }, currentUse);
        }
      }

      return finalUse(input, auth);
    };
  }
}

export const defaultResourceManager = new ResourceManager();
