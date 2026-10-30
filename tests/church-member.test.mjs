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

const invalid = validateChurchMember({ ...validMember, dateOfBirth: "1990-02-30", consent: false });
assert.equal(invalid.errors.dateOfBirth, "Enter a valid date of birth.");
assert.equal(invalid.errors.consent, "Confirm that the information is correct.");

const { token, hash } = createEditToken();
assert.equal(token.length, 64);
assert.equal(editTokenMatches(token, hash), true);
assert.equal(editTokenMatches(`${token.slice(0, -1)}0`, hash), false);
assert.equal(editTokenMatches("not-a-token", hash), false);

console.log("church-member validation and edit credential tests passed");
