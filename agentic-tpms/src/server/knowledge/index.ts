/**
 * Public surface of the knowledge base (course catalog, illustrative NOSS /
 * focus-area chunks, Bloom's taxonomy). Other modules import from here only.
 */
export { BLOOM_LEVELS, BLOOM_VERBS, bloomLevelOf, leadingVerb, validateOutcomes, type BloomLevel, type OutcomeVerdict, type OutcomeFailure } from "./bloom";
export { COURSE_SEEDS, KNOWLEDGE_CHUNK_SEEDS, specialtyTagsFor, type CourseSeed, type Seniority } from "./catalog";
export {
  SENIORITIES,
  embedCatalog,
  getCourse,
  getCourseByCode,
  isSeniority,
  searchCourses,
  searchKnowledge,
  seedKnowledge,
  type ChunkHit,
  type Course,
  type CourseHit,
  type SearchOptions,
} from "./service";
