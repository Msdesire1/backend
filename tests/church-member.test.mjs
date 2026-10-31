import assert from "node:assert/strict";
import {
  createEditToken,
  editTokenMatches,
  validateChurchMember,
} from "../services/churchMember.service.js";

const validMember = {
  fullName: "Ada Obi",
  title: "Mrs",
  phone: "08012345678",
  email: "ada@example.com",
  dateOfBirth: "1990-04-15",
  dateOrdained: "2018-03-20",
  occupation: "Teacher",
  workingPlace: "Living Faith School",
  dateJoinedCommission: "2010-01-15",
  commissionLocation: "Lagos",
  newBirthDate: "2008-07-04",
  dateJoinedLfcNewJerusalem: "2020-05-10",
  wofbiProgramme: "Basic Certificate Course",
  wofbiDateAttended: "2016-09-01",
  gender: "Female",
  maritalStatus: "Married",
  weddingAnniversary: "2015-09-10",
  spouseName: "Chidi Obi",
  spousePhone: "08011112222",
  numberOfChildren: "2",
  address: "Gaa Imam, Ilorin",
  membershipStatus: "Existing Member",
  wsfLocation: "Gaa Imam",
  serviceUnit: "Choir",
  birthdayAnniversarySmsConsent: true,
  consent: true,
};

const { errors, values } = validateChurchMember(validMember);
assert.deepEqual(errors, {});
assert.equal(values.phone, "+2348012345678");
assert.equal(values.spousePhone, "+2348011112222");
assert.equal(values.numberOfChildren, 2);
assert.equal(values.birthdayAnniversarySmsConsent, true);
assert.equal(values.occupation, "Teacher");
assert.equal(values.commissionLocation, "Lagos");
assert.equal(values.wofbiProgramme, "Basic Certificate Course");
assert.equal(values.dateOrdained.toISOString().slice(0, 10), "2018-03-20");
for (const title of ["Elder", "Elder Mrs", "Ordained Worker"]) {
  assert.equal(validateChurchMember({ ...validMember, title }).errors.title, undefined);
}

const withoutOptionalFields = validateChurchMember({
  ...validMember,
  dateOrdained: "",
  occupation: "",
  workingPlace: "",
  dateJoinedCommission: "",
  commissionLocation: "",
  newBirthDate: "",
  dateJoinedLfcNewJerusalem: "",
  wofbiProgramme: "",
  wofbiDateAttended: "",
});
assert.deepEqual(withoutOptionalFields.errors, {});
assert.equal(withoutOptionalFields.values.dateOrdained, null);

const invalid = validateChurchMember({ ...validMember, dateOfBirth: "1990-02-30", consent: false });
assert.equal(invalid.errors.dateOfBirth, "Enter a valid date of birth.");
assert.equal(invalid.errors.consent, "Confirm that the information is correct.");
assert.ok(validateChurchMember({ ...validMember, dateJoinedCommission: "not-a-date" }).errors.dateJoinedCommission);

const { token, hash } = createEditToken();
assert.equal(token.length, 64);
assert.equal(editTokenMatches(token, hash), true);
assert.equal(editTokenMatches(`${token.slice(0, -1)}0`, hash), false);
assert.equal(editTokenMatches("not-a-token", hash), false);

console.log("church-member validation and edit credential tests passed");
