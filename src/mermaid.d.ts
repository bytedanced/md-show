declare module "mermaid" {
  const mermaid: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, source: string) => Promise<{ svg: string }>;
  };

  export default mermaid;
}
