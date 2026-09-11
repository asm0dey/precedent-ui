// Every query that asks what is true now filters status = 'active'.
export const SAVED = [
  {
    name: "kin by tag overlap",
    cypher: `MATCH (p:Project)-[:TAGGED]->(t:Tag)<-[:TAGGED]-(o:Project)
WHERE p.id <> o.id
RETURN p AS project, t AS tag, o AS kin`,
  },
  {
    name: "contradictions (one project, one topic, two live answers)",
    cypher: `MATCH (a:Decision)-[:IN_PROJECT]->(p:Project)<-[:IN_PROJECT]-(b:Decision)
MATCH (a)-[:ABOUT]->(t:Topic)<-[:ABOUT]-(b)
WHERE a.status = 'active' AND b.status = 'active' AND a.id < b.id
RETURN p AS project, t AS topic, a AS one, b AS other`,
  },
  {
    name: "norms (an option chosen in 2+ projects)",
    cypher: `MATCH (d:Decision)-[:CHOSE]->(o:Option)
MATCH (d)-[:IN_PROJECT]->(p:Project)
WHERE d.status = 'active'
WITH o, count(DISTINCT p) AS projects
WHERE projects > 1
RETURN o AS option, projects
ORDER BY projects DESC`,
  },
  {
    name: "supersession chains",
    cypher: `MATCH (new:Decision)-[r:SUPERSEDES]->(old:Decision)
RETURN new AS replacement, r AS r, old AS superseded`,
  },
  {
    name: "regretted clusters",
    cypher: `MATCH (l:Lesson)-[r:REGRETS]->(d:Decision)
RETURN l AS lesson, r AS r, d AS decision`,
  },
  {
    name: "acknowledged divergences",
    cypher: `MATCH (d:Decision)-[r:DIVERGES_FROM]->(from:Decision)
RETURN d AS diverged, r AS r, from AS precedent`,
  },
];
