// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
	Alert,
	Box,
	Button,
	Form,
	SpaceBetween,
} from "@cloudscape-design/components";

import { generateClient } from "@aws-amplify/api";
import { fetchAuthSession } from "@aws-amplify/auth";

import { useDirectTranslation } from "./hooks/useDirectTranslation";

import { putObjectS3 } from "../../util/putObjectS3";
import { getBrowserLanguage } from "./util/getBrowserLanguage";
import { isDirectTranslationEligible } from "./util/isDirectTranslationEligible";

import NewFormDirectTranslation from "./newFormDirectTranslation";
import NewFormOriginalDocument from "./newFormOriginalDocument";
import NewFormOriginalLanguage from "./newFormOriginalLanguage";
import NewFormSavingJob from "./newFormSavingJob";
import NewFormTargetLanguages from "./newFormTargetLanguages";

import { v4 as uuid } from "uuid";

const features = require("../../features.json");
let createJob: string;
if (features.translation) {
	createJob = require("../../graphql/mutations").translationCreateJob;
}

const initialFormState: {
	saving: boolean;
	uploadDocument: boolean;
	submitJobInfo: boolean;
	usingDirectTranslation: boolean;
} = {
	saving: false,
	uploadDocument: false,
	submitJobInfo: false,
	usingDirectTranslation: false,
};

const initialOriginalDocumentFormErrors: {
	noOriginalDoc: boolean;
	unsupportedFileType: boolean;
	unsupportedFileSize: boolean;
} = {
	noOriginalDoc: false,
	unsupportedFileType: false,
	unsupportedFileSize: false,
};

export default function NewForm() {
	const [originalDocumentFileState, updateOriginalDocumentFileState] = useState<
		File | undefined
	>();
	const [originalDocumentFormErrors, updateOriginalDocumentFormErrors] =
		useState(initialOriginalDocumentFormErrors);
	const [originalLanguageSource, updateOriginalLanguageSource] =
		useState<string>(getBrowserLanguage());
	const [targetLanguagesSelectionState, updateTargetLanguagesSelectionState] =
		useState<string[]>([]);
	const [formState, updateFormState] = useState(initialFormState);
	const [isDirectTranslationAvailable, setIsDirectTranslationAvailable] =
		useState<boolean>(false);

	// Import the direct translation hook
	const {
		translateDocumentDirectly,
		isTranslating,
		progress,
		completedCount,
		totalCount,
	} = useDirectTranslation();

	const navigate = useNavigate();

	// Check if file is too large for direct translation
	const [isFileTooLargeForFast, setIsFileTooLargeForFast] =
		useState<boolean>(false);

	// Check if direct translation is available whenever relevant inputs change
	useEffect(() => {
		// First check if we have a file that's too large for direct translation
		if (originalDocumentFileState && originalDocumentFileState.size >= 100000) {
			setIsFileTooLargeForFast(true);
			setIsDirectTranslationAvailable(false);
		} else {
			setIsFileTooLargeForFast(false);

			// Then check other eligibility criteria
			const eligible = isDirectTranslationEligible(
				originalDocumentFileState,
				originalLanguageSource,
				targetLanguagesSelectionState
			);
			setIsDirectTranslationAvailable(eligible);
		}
	}, [
		originalDocumentFileState,
		originalLanguageSource,
		targetLanguagesSelectionState,
	]);

	const isError = () => {
		if (
			originalDocumentFormErrors.noOriginalDoc ||
			originalDocumentFormErrors.unsupportedFileType ||
			originalDocumentFormErrors.unsupportedFileSize
		) {
			return true;
		}

		if (!originalDocumentFileState) return true;

		if (targetLanguagesSelectionState.length === 0) return true;
	};

	const uploadFile = async (file: File, jobId: string) => {
		let identityId;
		try {
			const authSession = await fetchAuthSession();
			identityId = authSession.identityId;
		} catch (error) {
			console.log("Error fetching identityId:", error);
		}
		try {
			await putObjectS3({
				bucketKey: "awsUserFilesS3Bucket",
				path: `private/${identityId}/${jobId}/upload/${file.name}`,
				file: file,
			});
		} catch (error) {
			console.log(error);
		}
	};

	// Handle direct translation process
	async function handleDirectTranslation() {
		if (!originalDocumentFileState) return false;

		updateFormState((currentState) => ({
			...currentState,
			saving: true,
			usingDirectTranslation: true,
		}));

		try {
			// Create a job record with DIRECT_COMPLETED status
			const jobId = uuid();

			const translateStatus: { [key: string]: string } = {};
			const translateKey: { [key: string]: string } = {};
			const translateCallback: { [key: string]: string } = {};
			targetLanguagesSelectionState.forEach((element: string) => {
				translateStatus["lang" + element] = "Direct";
				translateKey["lang" + element] = "";
				translateCallback["lang" + element] = "";
			});

			const authSession = await fetchAuthSession();
			const jobInfo: {
				jobIdentity: string;
				id: string;
				jobName: string;
				languageSource: string;
				languageTargets: string;
				contentType: string;
				translateStatus: string;
				translateKey: string;
				translateCallback: string;
				jobStatus: string;
			} = {
				jobIdentity: authSession.identityId || "",
				id: jobId,
				jobName: originalDocumentFileState?.name || "",
				languageSource: originalLanguageSource,
				languageTargets: JSON.stringify([
					...new Set(targetLanguagesSelectionState),
				]),
				contentType: originalDocumentFileState?.type || "",
				translateStatus: JSON.stringify(translateStatus),
				translateKey: JSON.stringify(translateKey),
				translateCallback: JSON.stringify(translateCallback),
				jobStatus: "DIRECT_COMPLETED",
			};

			// Save the job info to DynamoDB
			try {
				const client = generateClient({ authMode: "userPool" });
				await client.graphql({
					query: createJob,
					variables: { input: jobInfo },
				});
			} catch (error) {
				console.log("Error uploading job info for direct translation");
				console.error(error);
			}

			// Perform the direct translation
			await translateDocumentDirectly(
				originalDocumentFileState,
				originalLanguageSource,
				targetLanguagesSelectionState
			);

			return true;
		} catch (error) {
			console.error("Error in direct translation:", error);
			return false;
		}
	}

	// Handle traditional translation process
	async function handleTraditionalTranslation() {
		if (isError()) return false;

		const jobId = uuid();

		updateFormState((currentState) => ({
			...currentState,
			saving: true,
		}));

		if (originalDocumentFileState) {
			await uploadFile(originalDocumentFileState, jobId);
			updateFormState((currentState) => ({
				...currentState,
				uploadDocument: true,
			}));
		}

		const translateStatus: { [key: string]: string } = {};
		const translateKey: { [key: string]: string } = {};
		const translateCallback: { [key: string]: string } = {};
		targetLanguagesSelectionState.forEach((element: string) => {
			translateStatus["lang" + element] = "Submitted";
			translateKey["lang" + element] = "";
			translateCallback["lang" + element] = "";
		});

		const authSession = await fetchAuthSession();
		const jobInfo: {
			jobIdentity: string;
			id: string;
			jobName: string;
			languageSource: string;
			languageTargets: string;
			contentType: string;
			translateStatus: string;
			translateKey: string;
			translateCallback: string;
			jobStatus: string;
		} = {
			jobIdentity: authSession.identityId || "",
			id: jobId,
			jobName: originalDocumentFileState?.name || "",
			languageSource: originalLanguageSource,
			languageTargets: JSON.stringify([
				...new Set(targetLanguagesSelectionState),
			]),
			contentType: originalDocumentFileState?.type || "",
			translateStatus: JSON.stringify(translateStatus),
			translateKey: JSON.stringify(translateKey),
			translateCallback: JSON.stringify(translateCallback),
			jobStatus: "UPLOADED",
		};

		try {
			const client = generateClient({ authMode: "userPool" });
			await client.graphql({
				query: createJob,
				variables: { input: jobInfo },
			});
			updateFormState((currentState) => ({
				...currentState,
				submitJobInfo: true,
			}));
			navigate("/translation/history");
		} catch (error) {
			console.log("Error uploading job info");
			throw error;
		}
	}

	// Main save function that decides which translation method to use
	async function save() {
		if (isError()) return false;

		if (isDirectTranslationAvailable) {
			return handleDirectTranslation();
		} else {
			return handleTraditionalTranslation();
		}
	}

	const { t } = useTranslation();

	return (
		<>
			{!formState.saving && (
				<form onSubmit={(e) => e.preventDefault()}>
					<SpaceBetween direction="vertical" size="xxl">
						{isDirectTranslationAvailable && (
							<Alert type="success">
								{t("translation_direct_eligible_message")}
							</Alert>
						)}
						{isFileTooLargeForFast && (
							<Alert type="info">
								{t("translation_file_too_large_for_fast")}
							</Alert>
						)}
						<Form
							actions={
								<SpaceBetween direction="horizontal" size="xxl">
									<Button
										formAction="none"
										variant="link"
										onClick={(e) => navigate("/translation/history")}
									>
										{t("generic_cancel")}
									</Button>
									<Button
										variant="primary"
										onClick={save}
										disabled={isError()}
										data-testid="translation-new-submit"
									>
										{t("generic_submit")}
									</Button>
								</SpaceBetween>
							}
						>
							<SpaceBetween direction="vertical" size="xxl">
								<NewFormOriginalDocument
									fileState={originalDocumentFileState}
									updateFileState={updateOriginalDocumentFileState}
									formErrors={originalDocumentFormErrors}
									updateFormErrors={updateOriginalDocumentFormErrors}
								/>

								<NewFormOriginalLanguage
									languageSource={originalLanguageSource}
									updateLanguageSource={updateOriginalLanguageSource}
								/>
								<NewFormTargetLanguages
									selectionState={targetLanguagesSelectionState}
									updateSelectionState={updateTargetLanguagesSelectionState}
									originalLanguage={originalLanguageSource}
								/>

								{isDirectTranslationAvailable && (
									<Box color="text-status-info">
										{t("translation_direct_info")}
									</Box>
								)}

								{!isDirectTranslationAvailable &&
									!isFileTooLargeForFast &&
									originalDocumentFileState &&
									targetLanguagesSelectionState.length > 0 && (
										<Box color="text-status-info">
											{t("translation_standard_info")}
										</Box>
									)}
							</SpaceBetween>
						</Form>
					</SpaceBetween>
				</form>
			)}

			{formState.saving && !formState.usingDirectTranslation && (
				<NewFormSavingJob
					submitJobInfo={formState.submitJobInfo}
					uploadDocument={formState.uploadDocument}
				/>
			)}

			{formState.saving && formState.usingDirectTranslation && (
				<NewFormDirectTranslation
					isTranslating={isTranslating}
					progress={progress}
					completedCount={completedCount}
					totalCount={totalCount}
				/>
			)}
		</>
	);
}
