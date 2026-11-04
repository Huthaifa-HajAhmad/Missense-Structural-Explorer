/**
 * The condition parts of ClinVar's variant record VCV000192324 (CNNM2 p.Glu357Lys), copied as served
 * (other parts left out; the submitter-level `<ClinicalAssertionList>` is cut to two of its three entries). This is the real case that showed the summary endpoint's blind spot: the summary
 * lists only "not provided", but the full record also holds the OMIM-sourced disease record.
 */
export const VCV_CNNM2_E357K = `<?xml version="1.0" encoding="UTF-8" ?>
<ClinVarResult-Set><VariationArchive VariationID="192324" Accession="VCV000192324">
  <ClassifiedRecord>
    <RCVList>
      <RCVAccession Title="NM_017649.5(CNNM2):c.1069G&gt;A (p.Glu357Lys) AND Hypomagnesemia, seizures, and intellectual disability 1" Accession="RCV000172914" Version="4">
        <ClassifiedConditionList TraitSetID="21727">
          <ClassifiedCondition DB="MedGen" ID="C4225333">Hypomagnesemia, seizures, and intellectual disability 1</ClassifiedCondition>
        </ClassifiedConditionList>
        <RCVClassifications>
          <GermlineClassification>
            <ReviewStatus>no assertion criteria provided</ReviewStatus>
            <Description DateLastEvaluated="2014-04-01" SubmissionCount="1">Pathogenic</Description>
          </GermlineClassification>
        </RCVClassifications>
      </RCVAccession>
      <RCVAccession Title="NM_017649.5(CNNM2):c.1069G&gt;A (p.Glu357Lys) AND not provided" Accession="RCV004819998" Version="2">
        <ClassifiedConditionList TraitSetID="9460">
          <ClassifiedCondition DB="MedGen" ID="C3661900">not provided</ClassifiedCondition>
        </ClassifiedConditionList>
        <RCVClassifications>
          <GermlineClassification>
            <ReviewStatus>criteria provided, multiple submitters, no conflicts</ReviewStatus>
            <Description DateLastEvaluated="2026-06-28" SubmissionCount="2">Pathogenic</Description>
          </GermlineClassification>
        </RCVClassifications>
      </RCVAccession>
    </RCVList>
    <ConditionList>
      <TraitSet ID="21727" Type="Disease" ContributesToAggregateClassification="false">
        <Trait ID="33528" Type="Disease">
          <Name>
            <ElementValue Type="Preferred">Hypomagnesemia, seizures, and intellectual disability 1</ElementValue>
            <XRef ID="MONDO:0020787" DB="MONDO"/>
          </Name>
          <Name>
            <ElementValue Type="Alternate">HYPOMAGNESEMIA, SEIZURES, AND IMPAIRED INTELLECTUAL DEVELOPMENT 1</ElementValue>
            <XRef Type="MIM" ID="616418" DB="OMIM"/>
            <XRef Type="Allelic variant" ID="607803.0004" DB="OMIM"/>
            <XRef Type="Allelic variant" ID="607803.0003" DB="OMIM"/>
          </Name>
          <Symbol>
            <ElementValue Type="Preferred">HOMGSMR1</ElementValue>
            <XRef Type="MIM" ID="616418" DB="OMIM"/>
          </Symbol>
          <AttributeSet>
            <Attribute Type="GARD id" integerValue="25248"/>
            <XRef ID="25248" DB="Office of Rare Diseases"/>
          </AttributeSet>
          <XRef ID="34527" DB="Orphanet"/>
          <XRef ID="C4225333" DB="MedGen"/>
          <XRef ID="MONDO:0020787" DB="MONDO"/>
          <XRef Type="MIM" ID="616418" DB="OMIM"/>
        </Trait>
      </TraitSet>
      <TraitSet ID="9460" Type="Disease" ContributesToAggregateClassification="true">
        <Trait ID="17556" Type="Disease">
          <Name>
            <ElementValue Type="Preferred">not provided</ElementValue>
            <XRef ID="13DG0619" DB="Genomic Medicine Center of Excellence, King Faisal Specialist Hospital and Research Centre"/>
          </Name>
          <Name>
            <ElementValue Type="Alternate">none provided</ElementValue>
          </Name>
          <AttributeSet>
            <Attribute Type="public definition">The term 'not provided' is registered in MedGen to support identification of submissions to ClinVar for which no condition was named.</Attribute>
          </AttributeSet>
          <XRef ID="C3661900" DB="MedGen"/>
        </Trait>
      </TraitSet>
    </ConditionList>
    <ClinicalAssertionList>
      <ClinicalAssertion ID="412164" ContributesToAggregateClassification="false">
        <TraitSet Type="Disease">
          <Trait Type="Disease">
            <Name>
              <ElementValue Type="Preferred">HYPOMAGNESEMIA, SEIZURES, AND IMPAIRED INTELLECTUAL DEVELOPMENT 1</ElementValue>
            </Name>
          </Trait>
        </TraitSet>
      </ClinicalAssertion>
      <ClinicalAssertion ID="10456673" ContributesToAggregateClassification="true">
        <TraitSet Type="Disease">
          <Trait Type="Disease">
            <Name>
              <ElementValue Type="Preferred">Not Provided</ElementValue>
            </Name>
          </Trait>
        </TraitSet>
      </ClinicalAssertion>
    </ClinicalAssertionList>
  </ClassifiedRecord>
</VariationArchive></ClinVarResult-Set>`;
