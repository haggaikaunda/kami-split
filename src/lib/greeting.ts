export function greeting(name?: string): string {
  return name ? `Hello, ${name}!` : 'Hello, world!';
}
