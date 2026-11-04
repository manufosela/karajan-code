// Every GraphQL document of the package lives here. Values only travel as variables, never concatenated into the text.
const ISSUE = "id identifier title description url state { name type } assignee { id email } labels { nodes { name } }";
export const Q = {
  viewer: "query Viewer { viewer { id name email } }",
  team: "query Team($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id states { nodes { id name } } } } }",
  labelFind: "query LabelFind($name: String!, $teamId: ID!) { issueLabels(filter: { name: { eq: $name }, or: [{ team: { id: { eq: $teamId } } }, { team: { null: true } }] }) { nodes { id name } } }",
  labelCreate: "mutation LabelCreate($name: String!, $teamId: String!) { issueLabelCreate(input: { name: $name, teamId: $teamId }) { success issueLabel { id } } }",
  create: `mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE} } } }`,
  get: `query Get($id: String!) { issue(id: $id) { ${ISSUE} } }`,
  update: "mutation Update($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }",
  user: "query User($email: String!) { users(filter: { email: { eq: $email } }) { nodes { id email } } }",
  list: `query List($team: String!, $label: String!, $after: String) { issues(first: 50, after: $after, filter: { team: { key: { eq: $team } }, labels: { name: { eq: $label } } }) { nodes { ${ISSUE} } pageInfo { hasNextPage endCursor } } }`,
};
