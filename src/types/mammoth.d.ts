/**
 * mammoth ships no type definitions, and DefinitelyTyped has none either.
 * Declared here rather than reached for with `any`, so a change in how we call
 * it is still a compile error. Only the surface this app uses is described.
 */
declare module "mammoth" {
  export type Message = {
    type: "warning" | "error";
    message: string;
  };

  export type Result = {
    value: string;
    messages: Message[];
  };

  export type Input = { arrayBuffer: ArrayBuffer };

  export type Options = {
    styleMap?: string | string[];
    /** Returning `{ src }` controls how an embedded image is rendered. */
    convertImage?: unknown;
    ignoreEmptyParagraphs?: boolean;
  };

  export function convertToHtml(input: Input, options?: Options): Promise<Result>;
  export function convertToMarkdown(input: Input, options?: Options): Promise<Result>;
  export function extractRawText(input: Input): Promise<Result>;
}
