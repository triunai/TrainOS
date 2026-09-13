/**
 * The trainers feature's public surface — the pool list and the trainer record.
 */

export { TrainersListPage } from "./TrainersListPage";
export { TrainerRecordPage } from "./TrainerRecordPage";
export { TRAINERS_LIST_PATH, TRAINER_DETAIL_PATTERN, trainerPath } from "./paths";
export {
  EXPIRY_HORIZON_DAYS,
  accreditationOf,
  nextBookedDay,
  tttStateOf,
  type Accreditation,
  type TttState,
} from "./accreditation";
