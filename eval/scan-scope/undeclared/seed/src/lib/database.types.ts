// FIXTURE `undeclared` — codegen tracciato, in un progetto che NON dichiara nulla.
// Secondo path coperto dal manifest (`**/database.types.ts`): senza dichiarazioni deve
// restare CONTATO come oggi. Vedi il sotto-test (11).

export interface Database {
  public: {
    Tables: {
      ordini: {
        Row: { id: string; cliente_id: string };
        Relationships: [
          {
            foreignKeyName: 'ordini_cliente_id_fkey';
            columns: ['cliente_id'];
            referencedRelation: 'clienti';
            referencedColumns: ['id'];
          },
        ];
      };
    };
  };
}
